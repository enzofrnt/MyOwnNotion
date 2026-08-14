/**
 * The workspace key hierarchy (T055/T060, feature 002).
 *
 * Four levels, each wrapping the one below:
 *
 *   1. **The deployment wrapping key** — 32 bytes on disk, mounted by the
 *      operator. Never in the database, never in a backup of it.
 *   2. **The workspace root key** — random, stored only wrapped under (1).
 *   3. **The data key generation** — random per generation, stored only
 *      wrapped under (2). Rotation mints a new generation and leaves the old
 *      one `decrypt-only` so records written under it stay readable.
 *   4. **The per-record key** — derived, never stored, from (3) by HKDF over a
 *      per-record salt.
 *
 * The shape is what makes rotation and compromise recovery tractable. Rotating
 * the deployment key rewraps one row per workspace rather than re-encrypting
 * every record; rotating the data key re-encrypts records but leaves the root
 * key alone; and a per-record key means a single leaked derivation exposes one
 * record rather than the workspace.
 *
 * **Every failure here is fail-closed.** A missing deployment key, an
 * unreadable wrap, a revoked generation: all refuse. There is no path that
 * returns plaintext when the key hierarchy is in doubt, because a system that
 * degrades to plaintext under stress is not encrypted at rest — it is
 * encrypted when convenient.
 */

import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@myownnotion/database";
import {
  findActiveRootKey,
  findCurrentGeneration,
  findCurrentWrappingKeyVersion,
  findGeneration,
  insertGeneration,
  insertRootKey,
  insertWrappingKeyVersion,
  updateWrappedRootKey,
} from "@myownnotion/database";
import {
  deriveRecordKey,
  EnvelopeDecryptionError,
  fromBase64Url,
  open,
  randomKey,
  seal,
  toBase64Url,
} from "@myownnotion/domain/security";

/**
 * Refusal to produce a key.
 *
 * One class for every cause. The operator learns which from the server log;
 * the caller learns only that protected data is unavailable, because "the
 * generation was revoked" and "the wrapping key is missing" are facts about
 * the installation's security posture.
 */
export class KeyUnavailableError extends Error {
  constructor(readonly reason: string) {
    super("protected data is unavailable");
    this.name = "KeyUnavailableError";
  }
}

/** AAD for wrapping one key under another. Binds the wrap to its purpose. */
function wrapAad(purpose: string, installationId: string, workspaceId: string, version: number) {
  return new Uint8Array(
    Buffer.from(`mn.wrap.v1|${purpose}|${installationId}|${workspaceId}|${version}`, "utf8"),
  );
}

/** A wrapped key, encoded for a text column. */
function encodeWrapped(sealed: ReturnType<typeof seal>): string {
  return [toBase64Url(sealed.nonce), toBase64Url(sealed.ciphertext), toBase64Url(sealed.tag)].join(
    ".",
  );
}

function decodeWrapped(encoded: string): ReturnType<typeof seal> {
  const parts = encoded.split(".");
  if (parts.length !== 3) {
    throw new EnvelopeDecryptionError();
  }
  return {
    nonce: fromBase64Url(parts[0] ?? ""),
    ciphertext: fromBase64Url(parts[1] ?? ""),
    tag: fromBase64Url(parts[2] ?? ""),
  };
}

export interface KeyHierarchyDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly workspaceId: string;
  /** Reads the mounted deployment key, or null when it is unavailable. */
  readonly deploymentKey: () => Buffer | null;
  readonly now: () => Date;
}

export interface DataKey {
  readonly generation: number;
  readonly material: Uint8Array;
}

export class KeyHierarchy {
  readonly #deps: KeyHierarchyDeps;

  /**
   * Unwrapped data keys, by generation, for the life of the process.
   *
   * Unwrapping costs a database read and an AES operation, and a request that
   * touches twenty records would otherwise pay it twenty times. The cache is
   * in memory only and dies with the process; it is never persisted, and it is
   * keyed by generation so a revoked generation is simply never inserted.
   */
  readonly #unwrapped = new Map<number, Uint8Array>();

  constructor(deps: KeyHierarchyDeps) {
    this.#deps = deps;
  }

  #wrappingKey(): Buffer {
    const key = this.#deps.deploymentKey();
    if (key === null) {
      throw new KeyUnavailableError("the deployment wrapping key is unavailable");
    }
    return key;
  }

  /**
   * Establishes the hierarchy for a workspace that has none.
   *
   * Idempotent by the partial unique indexes: a second caller finds the
   * existing active root key and current generation rather than minting a
   * second set. Two processes starting at once must not produce two root keys,
   * because records written under one would be unreadable under the other.
   *
   * Takes any executor rather than insisting on a transaction, because the
   * caller that matters is already inside one — the first protected write of a
   * mutation. Opening another here would deadlock against it.
   */
  async initialize(tx: Database | Transaction): Promise<void> {
    const wrappingKey = this.#wrappingKey();
    const { installationId, workspaceId } = this.#deps;
    const now = this.#deps.now();

    let wrappingVersion = await findCurrentWrappingKeyVersion(tx, installationId);
    if (wrappingVersion === null) {
      wrappingVersion = await insertWrappingKeyVersion(tx, {
        id: randomUUID(),
        installationId,
        version: 1,
        // A reference, never the bytes. The database must not contain the key
        // that protects it.
        externalSecretReference: "mounted:deployment-key",
        algorithm: "AES-256-GCM",
        createdAt: now,
      });
    }

    const existingRoot = await findActiveRootKey(tx, workspaceId);
    if (existingRoot === null) {
      const rootKey = randomKey();
      const wrapped = seal(
        new Uint8Array(wrappingKey),
        rootKey,
        wrapAad("root", installationId, workspaceId, 1),
      );
      await insertRootKey(tx, {
        id: randomUUID(),
        installationId,
        workspaceId,
        wrappingKeyVersionId: wrappingVersion.id,
        wrappedRootKey: encodeWrapped(wrapped),
        rootKeyVersion: 1,
        createdAt: now,
      });
    }

    const currentGeneration = await findCurrentGeneration(tx, workspaceId);
    if (currentGeneration === null) {
      const rootKey = await this.#rootKey(tx);
      const dataKey = randomKey();
      const wrapped = seal(rootKey, dataKey, wrapAad("data", installationId, workspaceId, 1));
      await insertGeneration(tx, {
        id: randomUUID(),
        installationId,
        workspaceId,
        generation: 1,
        wrappedKeyMaterial: encodeWrapped(wrapped),
        createdAt: now,
      });
    }
  }

  /**
   * Rewraps the workspace root key under a new deployment key.
   *
   * This is the entire cost of a wrapping-key rotation: one row per workspace.
   * Every protected record and file chunk stays byte-for-byte as it was,
   * because they are sealed under the *data* key, and the data key is sealed
   * under the root key, and only the root key's wrapper changes here.
   *
   * The new key is supplied rather than read from the mount: during a rotation
   * both keys exist, and the caller is the one that knows which is which. The
   * old key is still needed to unwrap what it wrapped, so this runs while the
   * mount still holds it.
   */
  async rewrapRootKey(
    tx: Transaction,
    input: {
      newWrappingKey: Uint8Array;
      newWrappingKeyVersionId: string;
      rewrapOperationId?: string;
    },
  ): Promise<{ rootKeyVersion: number }> {
    const stored = await findActiveRootKey(tx, this.#deps.workspaceId);
    if (stored === null) {
      throw new KeyUnavailableError("no active workspace root key");
    }
    // Unwrapped with the current key, rewrapped with the new one. The root key
    // itself is unchanged: rotating the wrapper must not rotate what it wraps,
    // or every data key underneath would need re-sealing too.
    const rootKey = await this.#rootKey(tx);
    const aad = wrapAad(
      "root",
      this.#deps.installationId,
      this.#deps.workspaceId,
      stored.rootKeyVersion,
    );
    const rewrapped = seal(new Uint8Array(input.newWrappingKey), rootKey, aad);

    await updateWrappedRootKey(tx, {
      rootKeyId: stored.id,
      wrappedRootKey: encodeWrapped(rewrapped),
      wrappingKeyVersionId: input.newWrappingKeyVersionId,
      ...(input.rewrapOperationId === undefined
        ? {}
        : { rewrapOperationId: input.rewrapOperationId }),
    });

    return { rootKeyVersion: stored.rootKeyVersion };
  }

  /** Unwraps the workspace root key. Never cached: it is used seldom. */
  async #rootKey(executor: Database | Transaction): Promise<Uint8Array> {
    const stored = await findActiveRootKey(executor, this.#deps.workspaceId);
    if (stored === null) {
      throw new KeyUnavailableError("no active workspace root key");
    }
    try {
      return open(
        new Uint8Array(this.#wrappingKey()),
        decodeWrapped(stored.wrappedRootKey),
        wrapAad("root", this.#deps.installationId, this.#deps.workspaceId, stored.rootKeyVersion),
      );
    } catch {
      // The wrap did not open. Either the mounted key is not the one this
      // installation was set up with, or the row has been tampered with.
      // Both are refusals, and neither is distinguishable from here.
      throw new KeyUnavailableError("the workspace root key could not be unwrapped");
    }
  }

  /**
   * The data key for a generation.
   *
   * `writable` distinguishes the two questions callers ask. A read may use a
   * `decrypt-only` generation — that is the whole point of retiring rather
   * than revoking one. A write may not: new records must go under the current
   * generation, or a rotation would never finish.
   */
  async dataKey(
    executor: Database | Transaction,
    input: { generation?: number; writable: boolean },
  ): Promise<DataKey> {
    let stored =
      input.generation === undefined
        ? await findCurrentGeneration(executor, this.#deps.workspaceId)
        : await findGeneration(executor, this.#deps.workspaceId, input.generation);

    // **Established on first write, not at startup.** Two things create the
    // hierarchy — this, and the bootstrap promotion, which mints the owner's
    // first data key as part of the atomic `0/0` → `1/1` transaction. Doing it
    // eagerly at startup collided with that: startup inserted generation 1,
    // and the promotion's own insert then violated the unique index, so
    // confirming setup failed outright.
    //
    // Creating it lazily removes the ordering problem entirely. Before bootstrap
    // there is no content to protect and nothing runs this; after it, the
    // promotion has already made the generation and this finds it. The only
    // case left is an installation whose ownership was established some other
    // way, and it gets a hierarchy the first time it writes.
    if (stored === null && input.generation === undefined && input.writable) {
      // "No current generation" is not the same as "no hierarchy". A retired or
      // revoked generation with no current one means a rotation left the
      // workspace in a state it should not be in, and minting generation 1
      // again would both violate the unique index and paper over it. The
      // hierarchy always starts at generation 1, so its presence is the test
      // for whether one exists at all.
      const established = await findGeneration(executor, this.#deps.workspaceId, 1);
      if (established === null) {
        // On the caller's executor, never a new transaction of our own. The
        // first protected write arrives from inside the mutation's
        // transaction, and opening a second one on another connection would
        // wait for locks that the first one holds — a deadlock that surfaced
        // as a 500 on the very first page anyone created.
        //
        // Running the inserts on the caller's executor also gives the right
        // atomicity for free: if the mutation rolls back, so does the
        // hierarchy it created.
        await this.initialize(executor);
        stored = await findCurrentGeneration(executor, this.#deps.workspaceId);
      }
    }

    if (stored === null) {
      throw new KeyUnavailableError(
        input.generation === undefined
          ? "no current data key generation"
          : `no data key generation ${input.generation}`,
      );
    }
    if (stored.state === "revoked") {
      // A revoked generation is refused for reads as well as writes. Records
      // under it are deliberately unreadable — that is what revocation means,
      // and softening it here would make the control decorative.
      throw new KeyUnavailableError(`data key generation ${stored.generation} is revoked`);
    }
    if (input.writable && stored.state !== "current") {
      throw new KeyUnavailableError(`data key generation ${stored.generation} is not writable`);
    }

    const cached = this.#unwrapped.get(stored.generation);
    if (cached !== undefined) {
      return { generation: stored.generation, material: cached };
    }

    const rootKey = await this.#rootKey(executor);
    let material: Uint8Array;
    try {
      material = open(
        rootKey,
        decodeWrapped(stored.wrappedKeyMaterial),
        wrapAad("data", this.#deps.installationId, this.#deps.workspaceId, stored.generation),
      );
    } catch {
      throw new KeyUnavailableError(
        `data key generation ${stored.generation} could not be unwrapped`,
      );
    }
    this.#unwrapped.set(stored.generation, material);
    return { generation: stored.generation, material };
  }

  /**
   * Derives the key for one record.
   *
   * A fresh salt per record, so two records with identical plaintext under the
   * same generation produce unrelated ciphertext, and so a derivation that
   * leaked would expose one record rather than the generation.
   */
  deriveForRecord(dataKey: DataKey, salt: Uint8Array, info: string): Uint8Array {
    return deriveRecordKey(dataKey.material, salt, info);
  }

  /** Drops cached material. Called when a generation is retired or revoked. */
  forget(generation?: number): void {
    if (generation === undefined) {
      this.#unwrapped.clear();
      return;
    }
    this.#unwrapped.delete(generation);
  }
}
