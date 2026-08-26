/**
 * Durable files dropped or pasted into the editor (T253–T254, FR-075).
 *
 * The byte staging and the editorial block are separate transactions with one
 * strict order: encrypted bytes become `ready`, then the block is committed.
 * A crash between them leaves either removable staging or a complete block
 * whose transfer is rediscovered at launch — never a block with vanished bytes.
 */

import type { PendingFileByteSource, PendingFileTransferStore } from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { PageCommand } from "@myownnotion/page-state";
import {
  createUpload,
  discoverUpload,
  sendRemaining,
  type UploadByteSource,
  type UploadHandle,
} from "../files/upload.ts";
import type { EditorEngine } from "./editor-engine.ts";

export interface InsertedFileBlock {
  readonly blockId: Uuid;
  readonly fileItemId: Uuid;
  readonly kind: "image" | "fileEmbed";
}

interface PlannedFileBlock extends InsertedFileBlock {
  readonly file: File;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function planDroppedFiles(files: readonly File[]): PlannedFileBlock[] {
  return files.map((file) => ({
    file,
    fileItemId: generateUuidV7(),
    blockId: generateUuidV7(),
    kind: isImageFile(file) ? "image" : "fileEmbed",
  }));
}

function commandsFor(
  planned: readonly PlannedFileBlock[],
  placement: { parentBlockId: Uuid | null; beforeBlockId: Uuid | null },
): PageCommand[] {
  return planned.map(({ blockId, fileItemId, kind, file }) =>
    kind === "image"
      ? {
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
        }
      : {
          type: "insert-block",
          parentBlockId: placement.parentBlockId,
          beforeBlockId: placement.beforeBlockId,
          block: { type: "fileEmbed", id: blockId, fileItemId, caption: file.name },
        },
  );
}

export class EditorFileStagingError extends Error {
  readonly reason: "quota" | "storage";

  constructor(reason: "quota" | "storage") {
    super(
      reason === "quota"
        ? "Le stockage local est plein : rien n’a été ajouté à la page."
        : "Le fichier n’a pas pu être protégé sur cet appareil : rien n’a été ajouté à la page.",
    );
    this.name = "EditorFileStagingError";
    this.reason = reason;
  }
}

/**
 * Stages all bytes first, then commits all blocks as one editor transaction.
 * Multi-file gestures are all-or-nothing: a failure removes every staging
 * already prepared before the editor is allowed to reference any identity.
 */
export async function insertDroppedFiles(
  engine: EditorEngine,
  files: readonly File[],
  placement: { parentBlockId: Uuid | null; beforeBlockId: Uuid | null },
  queue: EditorFileTransferQueue,
  attachmentParentItemId: Uuid,
): Promise<readonly InsertedFileBlock[]> {
  return queue.withEditorialCommit(async () => {
    const planned = planDroppedFiles(files);
    const staged: PlannedFileBlock[] = [];
    try {
      for (const entry of planned) {
        const result = await queue.stage(entry.fileItemId, entry.file, attachmentParentItemId);
        if (!result.ok) throw new EditorFileStagingError(result.reason);
        staged.push(entry);
      }
      if (planned.length === 0) return [];
      const committed = await engine.apply(commandsFor(planned, placement));
      if (!committed.changed) throw new Error("Le bloc fichier n’a pas été enregistré.");
    } catch (error) {
      await Promise.allSettled(staged.map(({ fileItemId }) => queue.discard(fileItemId)));
      throw error;
    }
    for (const entry of planned) {
      queue.activate(entry.fileItemId, entry.file, attachmentParentItemId);
    }
    return planned.map(({ file: _file, ...entry }) => entry);
  });
}

export type EditorFileTransferState =
  | { readonly kind: "queued" }
  | { readonly kind: "uploading"; readonly sent: number; readonly total: number }
  | { readonly kind: "verifying" }
  | { readonly kind: "synchronized" }
  | { readonly kind: "blocked"; readonly reason: string };

type Listener = (states: ReadonlyMap<Uuid, EditorFileTransferState>) => void;

interface EditorFileTransferQueueOptions {
  readonly store?: PendingFileTransferStore;
  readonly isReferenced?: (pageId: Uuid, fileItemId: Uuid) => Promise<boolean>;
  readonly concurrency?: number;
}

interface TransferEntry {
  readonly fileItemId: Uuid;
  readonly source: UploadByteSource;
  readonly attachmentParentItemId: Uuid;
  handle: UploadHandle | null;
  running: boolean;
}

/** Durable and bounded byte transfer for editor-referenced files. */
export class EditorFileTransferQueue {
  readonly #transfers = new Map<Uuid, TransferEntry>();
  readonly #localFiles = new Map<Uuid, File>();
  #states = new Map<Uuid, EditorFileTransferState>();
  readonly #listeners = new Set<Listener>();
  readonly #store: PendingFileTransferStore | null;
  readonly #isReferenced: EditorFileTransferQueueOptions["isReferenced"];
  readonly #concurrency: number;
  #initialization: Promise<void> | null = null;
  #flush: Promise<void> | null = null;
  #flushRequested = false;

  constructor(options: EditorFileTransferQueueOptions = {}) {
    this.#store = options.store ?? null;
    this.#isReferenced = options.isReferenced;
    this.#concurrency = Math.max(1, Math.trunc(options.concurrency ?? 3));
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#states);
    return () => this.#listeners.delete(listener);
  }

  stateFor(fileItemId: Uuid): EditorFileTransferState | undefined {
    return this.#states.get(fileItemId);
  }

  /** Bytes already materialized for a visible preview in this process. */
  localFileFor(fileItemId: Uuid): File | null {
    return this.#localFiles.get(fileItemId) ?? null;
  }

  /** Lazily decrypts a recovered file only when a visible block needs it. */
  async loadLocalFileFor(fileItemId: Uuid): Promise<File | null> {
    const cached = this.#localFiles.get(fileItemId);
    if (cached !== undefined) return cached;
    const restored = await this.#store?.loadFile(fileItemId);
    if (restored !== undefined && restored !== null) this.#localFiles.set(fileItemId, restored);
    return restored ?? null;
  }

  #publish(): void {
    for (const listener of this.#listeners) listener(this.#states);
  }

  async withEditorialCommit<T>(work: () => Promise<T>): Promise<T> {
    return this.#store === null ? work() : this.#store.withEditorialCommit(work);
  }

  /** Prepares ciphertext but deliberately does not make it upload-eligible yet. */
  async stage(
    fileItemId: Uuid,
    file: File,
    attachmentParentItemId: Uuid,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "quota" | "storage" }> {
    if (this.#store === null) return { ok: true };
    return this.#store.stage({ fileItemId, file, attachmentParentItemId });
  }

  /** Called only after the editor transaction that references this identity commits. */
  activate(fileItemId: Uuid, file: File, attachmentParentItemId: Uuid): void {
    this.#localFiles.set(fileItemId, file);
    if (!this.#transfers.has(fileItemId)) {
      this.#transfers.set(fileItemId, {
        fileItemId,
        source: file,
        attachmentParentItemId,
        handle: null,
        running: false,
      });
    }
    this.#states.set(fileItemId, { kind: "queued" });
    this.#publish();
  }

  /** Compatibility path for already-durable callers and focused unit tests. */
  enqueue(fileItemId: Uuid, file: File, attachmentParentItemId: Uuid): void {
    this.activate(fileItemId, file, attachmentParentItemId);
  }

  /** Removes preparation that never gained a committed editor reference. */
  async discard(fileItemId: Uuid): Promise<void> {
    this.#transfers.delete(fileItemId);
    this.#localFiles.delete(fileItemId);
    this.#states.delete(fileItemId);
    await this.#store?.remove(fileItemId);
    this.#publish();
  }

  /** Restores every referenced ready transfer before the workspace becomes interactive. */
  async initialize(): Promise<void> {
    const initialization =
      this.#initialization ??
      (async () => {
        await this.#restoreReadyTransfers();
      })();
    this.#initialization = initialization;
    try {
      await initialization;
    } catch (error) {
      if (this.#initialization === initialization) this.#initialization = null;
      throw error;
    }
  }

  async #restoreReadyTransfers(): Promise<void> {
    const store = this.#store;
    if (store === null) return;
    await store.withEditorialCommit(async () => {
      const recovered = await store.recoverIncomplete();
      const listing = await store.listReady();
      for (const fileItemId of [...recovered.blockedFileItemIds, ...listing.blockedFileItemIds]) {
        // A source restored before a later integrity failure must not remain
        // eligible for upload from stale in-memory metadata.
        this.#transfers.delete(fileItemId);
        this.#states.set(fileItemId, {
          kind: "blocked",
          reason:
            "Le fichier local chiffré n’a pas pu être vérifié. Il a été conservé sans être envoyé.",
        });
      }
      for (const metadata of listing.ready) {
        let referenced = true;
        if (this.#isReferenced !== undefined) {
          try {
            referenced = await this.#isReferenced(
              metadata.attachmentParentItemId,
              metadata.fileItemId,
            );
          } catch {
            this.#states.set(metadata.fileItemId, {
              kind: "blocked",
              reason: "La page liée au fichier local n’a pas pu être vérifiée.",
            });
            continue;
          }
        }
        if (!referenced) {
          this.#transfers.delete(metadata.fileItemId);
          this.#localFiles.delete(metadata.fileItemId);
          this.#states.delete(metadata.fileItemId);
          await store.remove(metadata.fileItemId);
          continue;
        }
        const source = await store.openSource(metadata.fileItemId);
        if (source === null) continue;
        this.#restore(source);
      }
      this.#publish();
    });
  }

  #restore(source: PendingFileByteSource): void {
    if (this.#transfers.has(source.fileItemId)) return;
    this.#transfers.set(source.fileItemId, {
      fileItemId: source.fileItemId,
      source,
      attachmentParentItemId: source.attachmentParentItemId,
      handle: null,
      running: false,
    });
    this.#states.set(source.fileItemId, { kind: "queued" });
  }

  /** Starts or resumes every queued transfer with bounded concurrency. */
  async flush(): Promise<void> {
    if (this.#flush !== null) {
      this.#flushRequested = true;
      return this.#flush;
    }
    const active = (async () => {
      do {
        this.#flushRequested = false;
        await this.#restoreReadyTransfers();
        const candidates = [...this.#transfers.values()].filter(
          (entry) => !entry.running && this.#states.get(entry.fileItemId)?.kind !== "synchronized",
        );
        for (let offset = 0; offset < candidates.length; offset += this.#concurrency) {
          const batch = candidates.slice(offset, offset + this.#concurrency);
          await Promise.all(
            batch.map(async (entry) => {
              entry.running = true;
              try {
                await this.#run(entry);
              } finally {
                entry.running = false;
              }
            }),
          );
        }
      } while (this.#flushRequested);
    })();
    this.#flush = active;
    try {
      await active;
    } finally {
      if (this.#flush === active) this.#flush = null;
    }
  }

  async #complete(entry: TransferEntry): Promise<void> {
    await this.#store?.remove(entry.fileItemId).catch(() => undefined);
    this.#states.set(entry.fileItemId, { kind: "synchronized" });
    this.#publish();
  }

  async #run(entry: TransferEntry): Promise<void> {
    if (this.#store !== null) {
      await this.#store.withTransferLease(entry.fileItemId, async () => this.#runWithLease(entry));
      return;
    }
    await this.#runWithLease(entry);
  }

  async #runWithLease(entry: TransferEntry): Promise<void> {
    const { fileItemId, source, attachmentParentItemId } = entry;
    try {
      let handle = entry.handle;
      if (handle === null) {
        this.#states.set(fileItemId, { kind: "uploading", sent: 0, total: source.size });
        this.#publish();
        const discovered = await discoverUpload(fileItemId);
        if (discovered.kind === "synchronized") {
          await this.#complete(entry);
          return;
        }
        if (discovered.kind === "blocked") {
          const reason =
            discovered.state.kind === "blocked"
              ? discovered.state.reason
              : "La reprise du transfert est bloquée.";
          this.#states.set(fileItemId, { kind: "blocked", reason });
          this.#publish();
          return;
        }
        if (discovered.kind === "upload") {
          handle = discovered.handle;
        } else {
          const created = await createUpload(source, fileItemId, attachmentParentItemId);
          if (!created.ok) {
            this.#states.set(fileItemId, {
              kind: "blocked",
              reason: created.state.kind === "blocked" ? created.state.reason : created.state.kind,
            });
            this.#publish();
            return;
          }
          handle = created.handle;
        }
        entry.handle = handle;
      }
      const final = await sendRemaining(handle, source, (state) => {
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
        await this.#complete(entry);
      } else if (final.kind === "verifying") {
        this.#states.set(fileItemId, { kind: "verifying" });
        this.#publish();
      } else if (final.kind === "blocked") {
        // Every retry rediscovers the deterministic server state. Keeping a
        // stale handle after expiry would otherwise turn a recoverable upload
        // into a permanent retry loop.
        entry.handle = null;
        this.#states.set(fileItemId, { kind: "blocked", reason: final.reason });
        this.#publish();
      }
    } catch {
      entry.handle = null;
      this.#states.set(fileItemId, {
        kind: "blocked",
        reason: "Transfert en attente du réseau.",
      });
      this.#publish();
    }
  }
}
