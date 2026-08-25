/**
 * Files dropped or pasted into the editor (T095, FR-023, FR-027).
 *
 * Two concerns stay separate on purpose. The document reference is an
 * editorial transaction: it goes through the same durable engine commit as any
 * other gesture, so a crash right after a drop keeps the block. The bytes are
 * a transfer: they follow the resumable feature-005 path and never gate the
 * local durability of the document that references them.
 */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import { createUpload, sendRemaining, type UploadHandle } from "../files/upload.ts";
import type { EditorEngine } from "./editor-engine.ts";

export interface InsertedFileBlock {
  readonly blockId: Uuid;
  readonly fileItemId: Uuid;
  readonly kind: "image" | "fileEmbed";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * Inserts one image or fileEmbed block per dropped file through the editing
 * engine. The document command commits durably before this promise resolves;
 * byte transfer is started separately by the caller's queue.
 */
export async function insertDroppedFiles(
  engine: EditorEngine,
  files: readonly File[],
  placement: { parentBlockId: Uuid | null; beforeBlockId: Uuid | null },
): Promise<readonly InsertedFileBlock[]> {
  const inserted: InsertedFileBlock[] = [];
  const commands: PageCommand[] = [];
  // Build every block first so one gesture lands as one atomic transaction.
  for (const file of files) {
    const fileItemId = generateUuidV7();
    const blockId = generateUuidV7();
    if (isImageFile(file)) {
      commands.push({
        type: "insert-block",
        parentBlockId: placement.parentBlockId,
        beforeBlockId: placement.beforeBlockId,
        block: {
          type: "image",
          id: blockId,
          fileItemId,
          caption: null,
          altText: file.name,
          displayWidth: null,
        },
      });
      inserted.push({ blockId, fileItemId, kind: "image" });
      continue;
    }
    commands.push({
      type: "insert-block",
      parentBlockId: placement.parentBlockId,
      beforeBlockId: placement.beforeBlockId,
      block: {
        type: "fileEmbed",
        id: blockId,
        fileItemId,
        caption: file.name,
      },
    });
    inserted.push({ blockId, fileItemId, kind: "fileEmbed" });
  }
  if (commands.length === 0) return inserted;
  await engine.apply(commands);
  return inserted;
}

export type EditorFileTransferState =
  | { readonly kind: "queued" }
  | { readonly kind: "uploading"; readonly sent: number; readonly total: number }
  | { readonly kind: "verifying" }
  | { readonly kind: "synchronized" }
  | { readonly kind: "blocked"; readonly reason: string };

type Listener = (states: ReadonlyMap<Uuid, EditorFileTransferState>) => void;

/**
 * Byte transfer for editor-referenced files.
 *
 * One transfer per `fileItemId`, retried from the server's own offset on every
 * failure — never from a client-side guess. States are announced to subscribers
 * (the block surfaces) without holding document content of any kind.
 */
export class EditorFileTransferQueue {
  readonly #transfers = new Map<
    Uuid,
    {
      readonly fileItemId: Uuid;
      readonly file: File;
      handle: UploadHandle | null;
      running: boolean;
    }
  >();
  #states = new Map<Uuid, EditorFileTransferState>();
  readonly #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#states);
    return () => this.#listeners.delete(listener);
  }

  stateFor(fileItemId: Uuid): EditorFileTransferState {
    return this.#states.get(fileItemId) ?? { kind: "queued" };
  }

  #publish(): void {
    for (const listener of this.#listeners) listener(this.#states);
  }

  enqueue(fileItemId: Uuid, file: File): void {
    if (this.#transfers.has(fileItemId)) return;
    this.#transfers.set(fileItemId, { fileItemId, file, handle: null, running: false });
    this.#states.set(fileItemId, { kind: "queued" });
    this.#publish();
  }

  /** Starts or resumes every queued transfer; safe to call again after any failure. */
  async flush(): Promise<void> {
    const started: Promise<void>[] = [];
    for (const transfer of this.#transfers.values()) {
      if (transfer.running) continue;
      const current = this.#states.get(transfer.fileItemId);
      if (current?.kind === "synchronized") continue;
      transfer.running = true;
      started.push(
        this.#run(transfer.fileItemId, transfer.file).finally(() => {
          transfer.running = false;
        }),
      );
    }
    await Promise.all(started);
  }

  async #run(fileItemId: Uuid, file: File): Promise<void> {
    const entry = this.#transfers.get(fileItemId);
    if (entry === undefined) return;
    try {
      let handle = entry.handle;
      if (handle === null) {
        this.#states.set(fileItemId, { kind: "uploading", sent: 0, total: file.size });
        this.#publish();
        const created = await createUpload(file, fileItemId);
        if (!created.ok) {
          this.#states.set(fileItemId, {
            kind: "blocked",
            reason: created.state.kind === "blocked" ? created.state.reason : created.state.kind,
          });
          this.#publish();
          return;
        }
        handle = created.handle;
        entry.handle = handle;
      }
      const final = await sendRemaining(handle, file, (state) => {
        if (state.kind === "uploading") {
          this.#states.set(fileItemId, {
            kind: "uploading",
            sent: state.sent,
            total: state.total,
          });
        } else if (state.kind === "verifying") {
          this.#states.set(fileItemId, { kind: "verifying" });
        } else if (state.kind === "blocked") {
          this.#states.set(fileItemId, { kind: "blocked", reason: state.reason });
        }
        this.#publish();
      });
      if (final.kind === "synchronized" && final.itemId === fileItemId) {
        this.#states.set(fileItemId, { kind: "synchronized" });
      } else if (final.kind === "verifying") {
        // A complete byte count is not a server verification. The final 201
        // response is the only event allowed to move this transfer to synced.
        this.#states.set(fileItemId, { kind: "verifying" });
      } else if (final.kind === "blocked") {
        this.#states.set(fileItemId, { kind: "blocked", reason: final.reason });
      }
      this.#publish();
    } catch {
      // Offline or aborted: the reference stays queued, never silently dropped.
      this.#states.set(fileItemId, {
        kind: "blocked",
        reason: "Transfert en attente du réseau.",
      });
      this.#publish();
    }
  }
}
