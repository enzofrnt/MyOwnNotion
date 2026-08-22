/**
 * Protected persistence boundary for operational page bytes (T137, US5).
 *
 * The routing tables retain UUIDs, digests and monotonic sequences. Every
 * version vector, frontier, Loro snapshot, update and ambiguity detail passes
 * through the existing workspace key hierarchy before a referencing row can
 * be committed.
 */

import type { Database, Transaction } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { ProtectedRecordService } from "../security/protected-record-service.ts";

export const PAGE_OPERATION_ENTITY_TYPES = {
  checkpoint: "page-operation.checkpoint",
  frontier: "page-operation.frontier",
  update: "page-operation.update",
  ambiguity: "page-operation.ambiguity",
  legacyResponse: "page-operation.legacy-response",
} as const;

export type PageOperationProtectedKind = keyof typeof PAGE_OPERATION_ENTITY_TYPES;
type Executor = Database | Transaction;

export interface ProtectedOperationalFrontier {
  readonly versionVector: Uint8Array;
  readonly frontiers: Uint8Array;
}

export interface OperationalUpdateEnvelopeInput {
  readonly updateBytes: Uint8Array;
  readonly baseFrontier: ProtectedOperationalFrontier;
  readonly resultFrontier: ProtectedOperationalFrontier;
}

export interface OperationalUpdateEnvelopeIds {
  readonly updateEnvelopeId: Uuid;
  readonly baseFrontierEnvelopeId: Uuid;
  readonly resultFrontierEnvelopeId: Uuid;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function encodeFrontier(frontier: ProtectedOperationalFrontier): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    Buffer.from(
      JSON.stringify({
        versionVector: Buffer.from(frontier.versionVector).toString("base64url"),
        frontiers: Buffer.from(frontier.frontiers).toString("base64url"),
      }),
      "utf8",
    ),
  );
}

function decodeFrontier(bytes: Uint8Array): ProtectedOperationalFrontier {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new TypeError("protected operational frontier is not valid JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)["versionVector"] !== "string" ||
    typeof (value as Record<string, unknown>)["frontiers"] !== "string"
  ) {
    throw new TypeError("protected operational frontier has an invalid shape");
  }
  const record = value as { versionVector: string; frontiers: string };
  return {
    versionVector: copyBytes(Buffer.from(record.versionVector, "base64url")),
    frontiers: copyBytes(Buffer.from(record.frontiers, "base64url")),
  };
}

export class PageOperationCrypto {
  readonly #records: ProtectedRecordService;

  constructor(records: ProtectedRecordService) {
    this.#records = records;
  }

  async sealBytes(
    executor: Transaction,
    kind: PageOperationProtectedKind,
    bytes: Uint8Array,
  ): Promise<Uuid> {
    const envelopeId = generateUuidV7();
    const storedId = await this.#records.write(executor, {
      id: envelopeId,
      entityType: PAGE_OPERATION_ENTITY_TYPES[kind],
      entityId: envelopeId,
      recordVersion: 1,
      payload: copyBytes(bytes),
    });
    if (storedId !== envelopeId) {
      throw new Error("protected operational envelope identity changed while being stored");
    }
    return envelopeId;
  }

  async openBytes(
    executor: Executor,
    kind: PageOperationProtectedKind,
    envelopeId: Uuid,
  ): Promise<Uint8Array> {
    const bytes = await this.#records.read(executor, {
      entityType: PAGE_OPERATION_ENTITY_TYPES[kind],
      entityId: envelopeId,
      recordVersion: 1,
    });
    if (bytes === null) throw new Error("protected operational envelope is missing");
    return copyBytes(bytes);
  }

  async openBytesMany(
    executor: Executor,
    kind: PageOperationProtectedKind,
    envelopeIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, Uint8Array>> {
    const opened = await this.#records.readMany(executor, {
      entityType: PAGE_OPERATION_ENTITY_TYPES[kind],
      entityIds: envelopeIds,
    });
    const result = new Map<Uuid, Uint8Array>();
    for (const [id, bytes] of opened) result.set(id as Uuid, copyBytes(bytes));
    return result;
  }

  async sealFrontier(executor: Transaction, frontier: ProtectedOperationalFrontier): Promise<Uuid> {
    return await this.sealBytes(executor, "frontier", encodeFrontier(frontier));
  }

  async openFrontier(executor: Executor, envelopeId: Uuid): Promise<ProtectedOperationalFrontier> {
    return decodeFrontier(await this.openBytes(executor, "frontier", envelopeId));
  }

  async openFrontiers(
    executor: Executor,
    envelopeIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, ProtectedOperationalFrontier>> {
    const opened = await this.openBytesMany(executor, "frontier", envelopeIds);
    const result = new Map<Uuid, ProtectedOperationalFrontier>();
    for (const [id, bytes] of opened) result.set(id, decodeFrontier(bytes));
    return result;
  }

  /** Seals one immutable catch-up batch with one key lookup and one SQL insert. */
  async sealUpdateBatch(
    executor: Transaction,
    updates: readonly OperationalUpdateEnvelopeInput[],
  ): Promise<readonly OperationalUpdateEnvelopeIds[]> {
    const identities = updates.map(() => ({
      updateEnvelopeId: generateUuidV7(),
      baseFrontierEnvelopeId: generateUuidV7(),
      resultFrontierEnvelopeId: generateUuidV7(),
    }));
    await this.#records.writeNewMany(
      executor,
      updates.flatMap((update, index) => {
        const ids = identities[index];
        if (ids === undefined) throw new Error("operational envelope identity is missing");
        return [
          {
            id: ids.baseFrontierEnvelopeId,
            entityType: PAGE_OPERATION_ENTITY_TYPES.frontier,
            entityId: ids.baseFrontierEnvelopeId,
            recordVersion: 1,
            payload: encodeFrontier(update.baseFrontier),
          },
          {
            id: ids.resultFrontierEnvelopeId,
            entityType: PAGE_OPERATION_ENTITY_TYPES.frontier,
            entityId: ids.resultFrontierEnvelopeId,
            recordVersion: 1,
            payload: encodeFrontier(update.resultFrontier),
          },
          {
            id: ids.updateEnvelopeId,
            entityType: PAGE_OPERATION_ENTITY_TYPES.update,
            entityId: ids.updateEnvelopeId,
            recordVersion: 1,
            payload: copyBytes(update.updateBytes),
          },
        ];
      }),
    );
    return identities;
  }
}
