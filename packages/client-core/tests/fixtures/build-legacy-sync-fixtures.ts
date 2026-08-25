/**
 * Deterministic encrypted IndexedDB profiles for schema-migration tests.
 *
 * Fixed keys and nonces are safe only for committed test fixtures. Production
 * code must keep using LocalCipher, which generates a fresh nonce for every
 * envelope. Keeping the fixture builder deterministic lets CI prove that a
 * migration preserved ciphertext byte-for-byte instead of merely preserving
 * something decryptable.
 */

import {
  canonicalAadBytes,
  canonicalAadFor,
  type EnvelopeBinding,
  type Uuid,
} from "@myownnotion/domain";
import {
  LOCAL_ENTITY_TYPES,
  LOCAL_ENVELOPE_ALGORITHM,
  LOCAL_ENVELOPE_FORMAT,
  type LocalEnvelope,
} from "../../src/security/local-encryption.ts";
import type { SecureKeyStorage, StoredLocalKey } from "../../src/security/local-key-state.ts";

export const LEGACY_SYNC_FIXTURE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type LegacySyncFixtureVersion = (typeof LEGACY_SYNC_FIXTURE_VERSIONS)[number];

export const LEGACY_SYNC_FIXTURE_CONTEXT = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
} as const;

const FIXTURE_KEY_ID = "legacy-sync-fixture-key-v1";
const FIXTURE_KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => (index * 17 + 29) & 0xff);

export const LEGACY_SYNC_STORE_NAMES = [
  "items",
  "placements",
  "relationships",
  "revisionHeaders",
  "outbox",
  "conflicts",
  "meta",
  "databases",
  "databaseEntries",
  "pageOperationStates",
  "pageOperationUpdates",
  "pageAmbiguities",
  "legacyOfflineBranches",
] as const;

export type LegacySyncStoreName = (typeof LEGACY_SYNC_STORE_NAMES)[number];
export type LegacySyncFixtureRow = Readonly<Record<string, unknown>>;

export interface LegacySyncFixture {
  readonly fixtureFormat: "myownnotion.legacy-sync-fixture+json";
  readonly fixtureFormatVersion: 1;
  readonly databaseVersion: LegacySyncFixtureVersion;
  readonly keyId: typeof FIXTURE_KEY_ID;
  readonly stores: Readonly<Partial<Record<LegacySyncStoreName, readonly LegacySyncFixtureRow[]>>>;
  readonly expected: {
    readonly pageId: Uuid;
    readonly conflictIds: readonly Uuid[];
    readonly storeNames: readonly LegacySyncStoreName[];
  };
}

const v1Stores = {
  items: "id, kind, lifecycle",
  placements: "id, itemId, parentKey, [parentKey+kind]",
  relationships: "id, sourceItemId, targetItemId",
  revisionHeaders: "id, itemId, local",
  outbox: "mutationId, status, enqueueOrder",
  conflicts: "mutationId, capturedAt",
  meta: "key",
} as const;

const v5Stores = {
  ...v1Stores,
  items: "id, kind, lifecycle, localAvailability",
} as const;

const v6Stores = {
  ...v5Stores,
  databases: "itemId",
  databaseEntries: "entryItemId, databaseId, availability, [databaseId+availability]",
} as const;

const v7Stores = {
  ...v6Stores,
  pageOperationStates: "pageId, status, localAvailability, lastAccessedAt",
  pageOperationUpdates: "updateId, pageId, status, enqueueOrder, [pageId+status]",
  pageAmbiguities: "ambiguityId, pageId, status, [pageId+status]",
  legacyOfflineBranches: "pageId, branchId, status",
} as const;

const v8Stores = {
  ...v7Stores,
  pageOperationUpdates: "updateId, pageId, status, enqueueOrder, [pageId+status], [status+pageId]",
} as const;

export function legacySyncStoresFor(
  version: LegacySyncFixtureVersion,
): Readonly<Record<string, string>> {
  if (version <= 4) return v1Stores;
  if (version === 5) return v5Stores;
  if (version === 6) return v6Stores;
  if (version === 7) return v7Stores;
  return v8Stores;
}

function fixtureUuid(version: LegacySyncFixtureVersion, group: number, index = 1): Uuid {
  const middle = String(version).padStart(4, "0");
  const suffix = String(group * 100 + index).padStart(12, "0");
  return `018f2b7c-${middle}-7000-8000-${suffix}` as Uuid;
}

function fixtureTimestamp(version: LegacySyncFixtureVersion, minute = 0): string {
  return `2026-01-${String(version).padStart(2, "0")}T03:${String(minute).padStart(2, "0")}:05.000Z`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function fixtureKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", FIXTURE_KEY_BYTES, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function nonceFor(version: LegacySyncFixtureVersion, ordinal: number): Uint8Array<ArrayBuffer> {
  if (ordinal < 1 || ordinal > 0xffff) throw new RangeError("fixture nonce ordinal is invalid");
  return Uint8Array.from([
    0x4d,
    0x4f,
    0x4e,
    0x18,
    version,
    0,
    0,
    0,
    0,
    0,
    ordinal >>> 8,
    ordinal & 0xff,
  ]);
}

async function sealFixtureValue(input: {
  readonly key: CryptoKey;
  readonly version: LegacySyncFixtureVersion;
  readonly ordinal: number;
  readonly entityType: string;
  readonly entityId: string;
  readonly recordVersion?: number;
  readonly value: unknown;
}): Promise<LocalEnvelope> {
  const binding: EnvelopeBinding = {
    ...LEGACY_SYNC_FIXTURE_CONTEXT,
    entityType: input.entityType,
    entityId: input.entityId,
    keyGeneration: 1,
    recordVersion: input.recordVersion ?? 1,
  };
  const nonce = nonceFor(input.version, input.ordinal);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.value));
  const aadSource = canonicalAadBytes(
    canonicalAadFor(LOCAL_ENVELOPE_FORMAT, LOCAL_ENVELOPE_ALGORITHM, binding),
  );
  const aad = new Uint8Array(new ArrayBuffer(aadSource.byteLength));
  aad.set(aadSource);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aad,
    },
    input.key,
    plaintext,
  );
  return {
    format: LOCAL_ENVELOPE_FORMAT,
    alg: LOCAL_ENVELOPE_ALGORITHM,
    keyId: FIXTURE_KEY_ID,
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Creates one representative historical profile without touching IndexedDB. */
export async function buildLegacySyncFixture(
  version: LegacySyncFixtureVersion,
): Promise<LegacySyncFixture> {
  const key = await fixtureKey();
  let envelopeOrdinal = 0;
  const seal = async (entityType: string, entityId: string, value: unknown, recordVersion = 1) => {
    envelopeOrdinal += 1;
    return await sealFixtureValue({
      key,
      version,
      ordinal: envelopeOrdinal,
      entityType,
      entityId,
      recordVersion,
      value,
    });
  };

  const pageId = fixtureUuid(version, 1);
  const blockId = fixtureUuid(version, 2);
  const currentRevisionId = fixtureUuid(version, 3);
  const outboxMutationId = fixtureUuid(version, 4);
  const relationshipId = fixtureUuid(version, 5);
  const placementId = fixtureUuid(version, 6);
  const document = {
    format: "myownnotion.document+json",
    formatVersion: 3,
    body: {
      blocks: [
        {
          id: blockId,
          type: "paragraph",
          content: [{ text: `Encrypted historical page ${version}` }],
        },
      ],
    },
  };
  const item: Record<string, unknown> = {
    id: pageId,
    kind: "page",
    lifecycle: "active",
    currentRevisionId,
    trashedAt: null,
    purgeAfter: null,
    sealedName: await seal(
      LOCAL_ENTITY_TYPES.itemName,
      pageId,
      `Encrypted historical title ${version}`,
    ),
    sealedPageBody: await seal(LOCAL_ENTITY_TYPES.pageBody, pageId, document),
    sealedFile: null,
    hasPageDocument: 1,
  };
  if (version >= 4) item["favourite"] = false;
  if (version >= 5) {
    item["offlineIntent"] = true;
    item["localAvailability"] = "present";
  }

  const relationship = {
    id: relationshipId,
    sourceItemId: pageId,
    targetItemId: fixtureUuid(version, 7),
    relationType: "mentions",
    sealedMetadata: await seal(LOCAL_ENTITY_TYPES.relationshipMetadata, relationshipId, {
      note: `Encrypted relationship ${version}`,
    }),
  };
  const outbox = {
    mutationId: outboxMutationId,
    commandType: "item.rename",
    baseRevisionIds: [currentRevisionId],
    localRevisionIds: [fixtureUuid(version, 8)],
    status: "pending",
    createdAt: fixtureTimestamp(version),
    lastAttemptAt: null,
    enqueueOrder: 1,
    sealedPayload: await seal(LOCAL_ENTITY_TYPES.outboxPayload, outboxMutationId, {
      itemId: pageId,
      name: `Encrypted queued rename ${version}`,
    }),
  };

  // v8 carries five refused drafts so the newest historical shape also proves
  // that migration scales beyond a single synthetic row. Earlier profiles
  // retain one each to prove every declared Dexie path.
  const conflictCount = version === 8 ? 5 : 1;
  const conflicts: LegacySyncFixtureRow[] = [];
  const conflictIds: Uuid[] = [];
  for (let index = 1; index <= conflictCount; index += 1) {
    const mutationId = fixtureUuid(version, 20, index);
    const baseRevisionId = fixtureUuid(version, 30, index);
    const localRevisionId = fixtureUuid(version, 40, index);
    conflictIds.push(mutationId);
    conflicts.push({
      mutationId,
      commandType: "page.document.replace",
      baseRevisionIds: [baseRevisionId],
      localRevisionIds: [localRevisionId],
      competingRevisionIds: [fixtureUuid(version, 50, index)],
      capturedAt: fixtureTimestamp(version, index),
      errorCode: "revision.stale-base",
      sealedPayload: await seal(LOCAL_ENTITY_TYPES.conflictPayload, mutationId, {
        itemId: pageId,
        baseRevisionId,
        document: {
          ...document,
          body: {
            blocks: [
              {
                id: blockId,
                type: "paragraph",
                content: [{ text: `Encrypted offline draft ${version}.${index}` }],
              },
            ],
          },
        },
      }),
    });
  }

  const stores: Partial<Record<LegacySyncStoreName, readonly LegacySyncFixtureRow[]>> = {
    items: [item],
    placements: [
      {
        id: placementId,
        itemId: pageId,
        kind: "hierarchy",
        parentItemId: null,
        parentKey: "root",
        positionKey: `a${version}`,
      },
    ],
    relationships: [relationship],
    revisionHeaders: [
      {
        id: currentRevisionId,
        itemId: pageId,
        mutationId: outboxMutationId,
        parentRevisionIds: [],
        acceptedAt: fixtureTimestamp(version),
        local: 1,
      },
    ],
    outbox: [outbox],
    conflicts,
    meta: [
      { key: "workspaceId", value: LEGACY_SYNC_FIXTURE_CONTEXT.workspaceId },
      { key: "schemaVersion", value: version },
      { key: "lastChangeCursor", value: String(version * 10) },
    ],
  };

  if (version >= 6) {
    const databaseId = fixtureUuid(version, 60);
    const entryId = fixtureUuid(version, 61);
    stores["databases"] = [
      {
        itemId: databaseId,
        definitionVersion: 1,
        sealedDefinition: await seal(
          LOCAL_ENTITY_TYPES.databaseDefinition,
          databaseId,
          {
            format: "myownnotion.database-definition+json",
            formatVersion: 1,
            databaseId,
            properties: [],
            views: [],
            taskRoles: null,
          },
          1,
        ),
      },
    ];
    stores["databaseEntries"] = [
      {
        entryItemId: entryId,
        databaseId,
        valueVersion: 1,
        availability: "present",
        sealedValues: await seal(
          LOCAL_ENTITY_TYPES.databaseEntryValues,
          entryId,
          {
            format: "myownnotion.database-entry-values+json",
            formatVersion: 1,
            databaseId,
            entryId,
            values: {},
            preserved: [],
          },
          1,
        ),
      },
    ];
  }

  if (version >= 7) {
    const updateId = fixtureUuid(version, 70);
    const ambiguityId = fixtureUuid(version, 71);
    const branchId = fixtureUuid(version, 72);
    stores["pageOperationStates"] = [
      {
        pageId,
        status: "active",
        operationalVersion: 1,
        canonicalFormatVersion: 3,
        latestServerPageSequence: 2,
        localAvailability: "present",
        lastAccessedAt: fixtureTimestamp(version),
        recordVersion: 1,
        sealedState: await seal(LOCAL_ENTITY_TYPES.pageOperationState, pageId, {
          payloadVersion: 1,
          fixture: `Encrypted checkpoint ${version}`,
        }),
      },
    ];
    stores["pageOperationUpdates"] = [
      {
        updateId,
        pageId,
        status: "pending",
        enqueueOrder: 1,
        createdAt: fixtureTimestamp(version),
        recordVersion: 1,
        sealedBody: await seal(LOCAL_ENTITY_TYPES.pageOperationUpdate, `${pageId}.${updateId}`, {
          payloadVersion: 1,
          fixture: `Encrypted update ${version}`,
        }),
      },
    ];
    stores["pageAmbiguities"] = [
      {
        ambiguityId,
        pageId,
        kind: "delete-edit",
        status: "open",
        openedAt: fixtureTimestamp(version),
        recordVersion: 1,
        sealedDetails: await seal(
          LOCAL_ENTITY_TYPES.pageAmbiguityDetails,
          `${pageId}.${ambiguityId}`,
          { payloadVersion: 1, fixture: `Encrypted ambiguity ${version}` },
        ),
      },
    ];
    stores["legacyOfflineBranches"] = [
      {
        pageId,
        branchId,
        status: "editing",
        createdAt: fixtureTimestamp(version),
        recordVersion: 1,
        sealedBranch: await seal(LOCAL_ENTITY_TYPES.legacyOfflineBranch, `${pageId}.${branchId}`, {
          payloadVersion: 1,
          fixture: `Encrypted branch ${version}`,
        }),
      },
    ];
  }

  return {
    fixtureFormat: "myownnotion.legacy-sync-fixture+json",
    fixtureFormatVersion: 1,
    databaseVersion: version,
    keyId: FIXTURE_KEY_ID,
    stores,
    expected: {
      pageId,
      conflictIds,
      storeNames: Object.keys(stores) as LegacySyncStoreName[],
    },
  };
}

/** Key custody matching the committed test envelopes, for post-upgrade proofs. */
export async function createLegacySyncFixtureKeyStorage(): Promise<SecureKeyStorage> {
  const stored: StoredLocalKey = { keyId: FIXTURE_KEY_ID, key: await fixtureKey() };
  return {
    kind: "fallback",
    load: async () => stored,
    save: async () => undefined,
    clear: async () => undefined,
  };
}
