/**
 * Google Drive, behind the same three methods as a directory (T042, FR-009).
 *
 * The canvas names Drive as the first remote destination. Everything specific to
 * it is confined here, and nothing outside this file knows it exists — which is
 * the point of the boundary rather than a nicety: every test in this feature runs
 * against the filesystem destination, so the third-party dependency is never on
 * the path that proves the feature works.
 *
 * **Drive never sees anything readable.** The object it stores is the sealed
 * archive, and the name carries a date and an identifier. There is no manifest
 * beside it, no folder named after the workspace, and no description — a provider
 * that can list your backups should learn nothing from the listing.
 *
 * Credentials are mounted, never stored. A refresh token in the database would
 * be a live credential inside the very thing the backup exists to reproduce: an
 * archive of that database would then carry the key to the account holding every
 * other archive.
 */

import { Readable, Transform } from "node:stream";
import type { BackupDestination, StoredBackup } from "./destination.ts";
import { DestinationUnavailableError } from "./destination.ts";

export interface GoogleDriveConfig {
  /** Reads the current token from mounted material; the destination never stores it. */
  readonly accessToken: () => string | Promise<string>;
  /** The folder objects are written into; created by the operator, not by us. */
  readonly folderId: string;
  /** Overridable so a contract test can point at a recorded interaction. */
  readonly baseUrl?: string;
  readonly uploadUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly size?: string;
  readonly createdTime?: string;
}

export class GoogleDriveDestination implements BackupDestination {
  readonly name = "google-drive";

  constructor(private readonly config: GoogleDriveConfig) {}

  #fetch(): typeof globalThis.fetch {
    return this.config.fetch ?? globalThis.fetch;
  }

  async #headers(): Promise<Record<string, string>> {
    const token = (await this.config.accessToken()).trim();
    if (token.length === 0) {
      throw new DestinationUnavailableError(this.name, "the mounted credential is empty");
    }
    return { authorization: `Bearer ${token}` };
  }

  #base(): string {
    return this.config.baseUrl ?? "https://www.googleapis.com/drive/v3";
  }

  async #request(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.#fetch()(url, init);
    } catch {
      // Provider and network exceptions carry URLs and proxy details. Collapse
      // them at the boundary before they can reach a verification row or CLI.
      throw new DestinationUnavailableError(this.name, "the provider could not be reached");
    }
  }

  /**
   * Turns a Drive failure into one this feature can act on.
   *
   * The body is deliberately not included. A provider's error text is written for
   * a developer reading a console, and this string ends up in a verification
   * row that an owner can read — where a quoted request URL would carry the
   * folder identifier into a place it does not belong.
   */
  #unavailable(operation: string, status: number): never {
    throw new DestinationUnavailableError(this.name, `${operation} failed with status ${status}`);
  }

  async put(name: string, contents: Readable, byteLength: number): Promise<void> {
    // The session is a Drive detail kept on this side of the boundary. The
    // generic caller still gives us one stream, while Drive gets an upload that
    // does not hold a multi-gigabyte archive in process memory.
    const session = await this.#request(
      `${this.config.uploadUrl ?? "https://www.googleapis.com/upload/drive/v3/files"}?uploadType=resumable`,
      {
        method: "POST",
        headers: {
          ...(await this.#headers()),
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(byteLength),
          "x-upload-content-type": "application/octet-stream",
        },
        body: JSON.stringify({ name, parents: [this.config.folderId] }),
      },
    );
    if (!session.ok) {
      this.#unavailable("starting an upload", session.status);
    }
    const location = session.headers.get("location");
    if (location === null) {
      throw new DestinationUnavailableError(
        this.name,
        "Drive did not return a resumable upload location",
      );
    }

    let sent = 0;
    const counted = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sent += chunk.byteLength;
        callback(null, chunk);
      },
    });
    contents.pipe(counted);
    const uploaded = await this.#request(location, {
      method: "PUT",
      headers: {
        ...(await this.#headers()),
        "content-length": String(byteLength),
        "content-type": "application/octet-stream",
      },
      // Node's fetch accepts a Readable when `duplex` is half. The DOM-shaped
      // RequestInit type does not expose that Node option, hence this narrow
      // cast at the provider boundary.
      body: counted as never,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!uploaded.ok) {
      this.#unavailable("upload", uploaded.status);
    }
    if (sent !== byteLength) {
      // The caller told us how large the archive is; a mismatch means the stream
      // and the record disagree, and recording a size we did not send would make
      // the after-transfer check compare against a fiction.
      throw new DestinationUnavailableError(
        this.name,
        "the archive read from disk was not the size it was declared as",
      );
    }
  }

  async list(): Promise<StoredBackup[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const parameters = new URLSearchParams({
        q: `'${escapeDriveQuery(this.config.folderId)}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,size,createdTime)",
        pageSize: "1000",
      });
      if (pageToken !== undefined) {
        parameters.set("pageToken", pageToken);
      }
      const response = await this.#request(`${this.#base()}/files?${parameters}`, {
        headers: await this.#headers(),
      });
      if (!response.ok) {
        this.#unavailable("list", response.status);
      }
      const body = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken !== undefined);

    return files.map((file) => ({
      name: file.name,
      byteLength: Number.parseInt(file.size ?? "0", 10),
      storedAt: file.createdTime === undefined ? new Date(0) : new Date(file.createdTime),
    }));
  }

  async read(name: string): Promise<Readable | null> {
    const file = await this.#find(name);
    if (file === null) {
      // Absent is an answer, not an exception: verification needs to record "the
      // destination no longer holds this backup" rather than survive a throw.
      return null;
    }
    const response = await this.#request(`${this.#base()}/files/${file.id}?alt=media`, {
      headers: await this.#headers(),
    });
    if (!response.ok) {
      this.#unavailable("download", response.status);
    }
    if (response.body === null) {
      throw new DestinationUnavailableError(this.name, "Drive returned an empty download body");
    }
    return Readable.fromWeb(response.body as never);
  }

  async delete(name: string): Promise<void> {
    const file = await this.#find(name);
    if (file === null) {
      // Already gone. Retention asking twice must not fail the pass, or one
      // manual deletion would stop every future prune.
      return;
    }
    const response = await this.#request(`${this.#base()}/files/${file.id}`, {
      method: "DELETE",
      headers: await this.#headers(),
    });
    if (!response.ok && response.status !== 404) {
      this.#unavailable("delete", response.status);
    }
  }

  async #find(name: string): Promise<DriveFile | null> {
    const parameters = new URLSearchParams({
      q: `'${escapeDriveQuery(this.config.folderId)}' in parents and name = '${escapeDriveQuery(name)}' and trashed = false`,
      fields: "files(id,name)",
      pageSize: "1",
    });
    const response = await this.#request(`${this.#base()}/files?${parameters}`, {
      headers: await this.#headers(),
    });
    if (!response.ok) {
      this.#unavailable("lookup", response.status);
    }
    const body = (await response.json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }
}

/** Escapes a literal inside Drive's query language, not inside the URL. */
function escapeDriveQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
