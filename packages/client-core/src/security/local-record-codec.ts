/**
 * Sealing the projection rows (T058, US4, FR-012, FR-024).
 *
 * What is sealed and what is not follows the server's boundary exactly.
 * Identifiers, kind, lifecycle, revision pointers, parent keys, and position
 * keys stay readable: they are how the client answers "what is in this
 * folder" and "what changed", and sealing them would put the device key in
 * play for every navigation while still leaking the shape of the workspace
 * through the index structure. Everything a person wrote — titles, page
 * bodies, file names, relationship metadata, queued mutation payloads — is
 * sealed.
 *
 * Identities are preserved byte for byte (FR-024). A sealed row keeps the same
 * primary key and the same foreign keys as the row it replaced, so the local
 * projection continues to reconcile against the server without a translation
 * table.
 */

import type { Uuid } from "@myownnotion/domain";
import type {
  ConflictRecordRow,
  LocalItemRow,
  LocalRelationshipRow,
  OutboxMutationRow,
} from "../local-store/schema.ts";
import { LOCAL_ENTITY_TYPES, type LocalCipher, type LocalEnvelope } from "./local-encryption.ts";

/** The workspace an envelope binds to. Supplied once, per store. */
export interface LocalBindingContext {
  readonly installationId: string;
  readonly workspaceId: string;
}

export interface SealedLocalItemRow extends Omit<LocalItemRow, "name" | "pageDocument" | "file"> {
  readonly sealedName: LocalEnvelope;
  readonly sealedPageBody: LocalEnvelope | null;
  readonly sealedFile: LocalEnvelope | null;
  /** Kept in the clear: the client renders a placeholder without unlocking. */
  readonly hasPageDocument: 0 | 1;
}

export interface SealedLocalRelationshipRow extends Omit<LocalRelationshipRow, "metadata"> {
  readonly sealedMetadata: LocalEnvelope;
}

export interface SealedOutboxMutationRow extends Omit<OutboxMutationRow, "payload"> {
  readonly sealedPayload: LocalEnvelope;
}

export interface SealedConflictRecordRow extends Omit<ConflictRecordRow, "payload"> {
  readonly sealedPayload: LocalEnvelope;
}

/**
 * Seals and opens projection rows.
 *
 * `recordVersion` is deliberately part of every binding: replaying an older
 * ciphertext over a newer row would otherwise authenticate cleanly and roll
 * the record back without any error.
 */
export class LocalRecordCodec {
  readonly #cipher: LocalCipher;
  readonly #context: LocalBindingContext;

  constructor(cipher: LocalCipher, context: LocalBindingContext) {
    this.#cipher = cipher;
    this.#context = context;
  }

  #binding(entityType: string, entityId: string, recordVersion: number) {
    return {
      installationId: this.#context.installationId,
      workspaceId: this.#context.workspaceId,
      entityType,
      entityId,
      keyGeneration: 1,
      recordVersion,
    };
  }

  async sealItem(row: LocalItemRow, recordVersion = 1): Promise<SealedLocalItemRow> {
    const { name, pageDocument, file, ...rest } = row;
    return {
      ...rest,
      sealedName: await this.#cipher.seal(
        this.#binding(LOCAL_ENTITY_TYPES.itemName, row.id, recordVersion),
        name,
      ),
      sealedPageBody:
        pageDocument === null
          ? null
          : await this.#cipher.seal(
              this.#binding(LOCAL_ENTITY_TYPES.pageBody, row.id, recordVersion),
              pageDocument,
            ),
      sealedFile:
        file === null
          ? null
          : await this.#cipher.seal(
              this.#binding(LOCAL_ENTITY_TYPES.fileMetadata, row.id, recordVersion),
              file,
            ),
      hasPageDocument: pageDocument === null ? 0 : 1,
    };
  }

  async openItem(row: SealedLocalItemRow, recordVersion = 1): Promise<LocalItemRow> {
    const { sealedName, sealedPageBody, sealedFile, hasPageDocument: _ignored, ...rest } = row;
    return {
      ...rest,
      name: (await this.#cipher.open(
        this.#binding(LOCAL_ENTITY_TYPES.itemName, row.id, recordVersion),
        sealedName,
      )) as string,
      pageDocument:
        sealedPageBody === null
          ? null
          : ((await this.#cipher.open(
              this.#binding(LOCAL_ENTITY_TYPES.pageBody, row.id, recordVersion),
              sealedPageBody,
            )) as LocalItemRow["pageDocument"]),
      file:
        sealedFile === null
          ? null
          : ((await this.#cipher.open(
              this.#binding(LOCAL_ENTITY_TYPES.fileMetadata, row.id, recordVersion),
              sealedFile,
            )) as LocalItemRow["file"]),
    };
  }

  async sealRelationship(
    row: LocalRelationshipRow,
    recordVersion = 1,
  ): Promise<SealedLocalRelationshipRow> {
    const { metadata, ...rest } = row;
    return {
      ...rest,
      sealedMetadata: await this.#cipher.seal(
        this.#binding(LOCAL_ENTITY_TYPES.relationshipMetadata, row.id, recordVersion),
        metadata,
      ),
    };
  }

  async openRelationship(
    row: SealedLocalRelationshipRow,
    recordVersion = 1,
  ): Promise<LocalRelationshipRow> {
    const { sealedMetadata, ...rest } = row;
    return {
      ...rest,
      metadata: (await this.#cipher.open(
        this.#binding(LOCAL_ENTITY_TYPES.relationshipMetadata, row.id, recordVersion),
        sealedMetadata,
      )) as Record<string, unknown>,
    };
  }

  async sealOutbox(row: OutboxMutationRow): Promise<SealedOutboxMutationRow> {
    const { payload, ...rest } = row;
    return {
      ...rest,
      sealedPayload: await this.#cipher.seal(
        this.#binding(LOCAL_ENTITY_TYPES.outboxPayload, row.mutationId, 1),
        payload,
      ),
    };
  }

  async openOutbox(row: SealedOutboxMutationRow): Promise<OutboxMutationRow> {
    const { sealedPayload, ...rest } = row;
    return {
      ...rest,
      payload: (await this.#cipher.open(
        this.#binding(LOCAL_ENTITY_TYPES.outboxPayload, row.mutationId, 1),
        sealedPayload,
      )) as Record<string, unknown>,
    };
  }

  async sealConflict(row: ConflictRecordRow): Promise<SealedConflictRecordRow> {
    const { payload, ...rest } = row;
    return {
      ...rest,
      sealedPayload: await this.#cipher.seal(
        this.#binding(LOCAL_ENTITY_TYPES.conflictPayload, row.mutationId, 1),
        payload,
      ),
    };
  }

  async openConflict(row: SealedConflictRecordRow): Promise<ConflictRecordRow> {
    const { sealedPayload, ...rest } = row;
    return {
      ...rest,
      payload: (await this.#cipher.open(
        this.#binding(LOCAL_ENTITY_TYPES.conflictPayload, row.mutationId, 1),
        sealedPayload,
      )) as Record<string, unknown>,
    };
  }
}

/** Identity fields a sealed row must carry through untouched (FR-024). */
export const PRESERVED_ITEM_IDENTITY_FIELDS = [
  "id",
  "kind",
  "lifecycle",
  "currentRevisionId",
] as const satisfies ReadonlyArray<keyof LocalItemRow>;

export type { Uuid };
