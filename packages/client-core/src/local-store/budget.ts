/**
 * How much room this device has, and what it may release (T039, T040, US4).
 *
 * Two responsibilities kept apart on purpose. Measuring is the browser's job
 * and only the browser can do it. Deciding what to release is the
 * application's, because the priority order in FR-015 and FR-017 is a product
 * rule the browser knows nothing about: left to its own eviction, a browser can
 * discard an origin's storage wholesale and take unsynchronized work with it.
 *
 * So `measure` reports and `runEviction` decides, and the decision is delegated
 * to the pure rule in the domain rather than reimplemented here.
 */

import { type EvictionCandidate, planEviction } from "@myownnotion/domain";
import { Outbox } from "../outbox/outbox.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";
import type { LocalDatabase } from "./schema.ts";

/** 5 GB, per FR-014, and adjustable on this device. */
export const DEFAULT_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;

export interface StorageMeasurement {
  /** `null` means unlimited: the absence of a limit, not a large number. */
  readonly limitBytes: number | null;
  readonly usedBytes: number;
  /** Whether the browser granted durable storage. */
  readonly persisted: boolean;
  readonly measuredAt: string;
  /** What the space is going to, so FR-019 can explain rather than only report. */
  readonly breakdown: ReadonlyArray<{ readonly label: string; readonly bytes: number }>;
}

const LIMIT_KEY = "storageLimitBytes";
const LIMIT_UNSET = "unset";

/**
 * Reads what this device is holding.
 *
 * `estimate()` is used rather than our own byte counting: our own accounting
 * drifts from what the device actually reports, and a number shown to an owner
 * that disagrees with their disk is worse than no number.
 */
export async function measure(db: LocalDatabase): Promise<StorageMeasurement> {
  const limitBytes = await readLimit(db);
  const estimate = await estimateUsage();
  const breakdown = await breakdownOf(db);
  return {
    limitBytes,
    usedBytes: estimate.usage,
    persisted: estimate.persisted,
    measuredAt: new Date().toISOString(),
    breakdown,
  };
}

async function estimateUsage(): Promise<{ usage: number; persisted: boolean }> {
  // Guarded because the API is absent in some contexts, and a storage panel
  // that throws is worse than one that admits it does not know.
  if (typeof navigator === "undefined" || navigator.storage === undefined) {
    return { usage: 0, persisted: false };
  }
  const estimate = await navigator.storage.estimate?.();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage: estimate?.usage ?? 0, persisted };
}

/**
 * Asks the browser to keep this origin's data.
 *
 * Requested rather than assumed. Without durability the browser may clear the
 * projection under pressure, which for unsynchronized work is exactly the loss
 * FR-017 forbids — so the answer is recorded and shown rather than hoped for.
 */
export async function requestDurability(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.storage?.persist === undefined) {
    return false;
  }
  return navigator.storage.persist();
}

export async function readLimit(db: LocalDatabase): Promise<number | null> {
  const row = await db.meta.get(LIMIT_KEY);
  if (row === undefined) {
    return DEFAULT_LIMIT_BYTES;
  }
  return row.value === LIMIT_UNSET ? null : Number(row.value);
}

/** `null` sets unlimited. */
export async function writeLimit(db: LocalDatabase, limitBytes: number | null): Promise<void> {
  await db.meta.put({ key: LIMIT_KEY, value: limitBytes === null ? LIMIT_UNSET : limitBytes });
}

/**
 * Roughly how much room a sealed envelope takes.
 *
 * The ciphertext is stored base64, so its length over-states the payload by a
 * third. Not corrected, and deliberately: this figure orders eviction and
 * explains where space went, and a consistent over-estimate does both correctly
 * while pretending to a precision the browser does not offer either.
 */
function envelopeBytes(envelope: { readonly ciphertext: string } | null | undefined): number {
  return envelope === null || envelope === undefined ? 0 : envelope.ciphertext.length;
}

/** What is holding the space, grouped as an owner would think of it. */
async function breakdownOf(db: LocalDatabase): Promise<Array<{ label: string; bytes: number }>> {
  const [items, states, updates, ambiguities, branches] = await Promise.all([
    db.items.toArray(),
    db.pageOperationStates.toArray(),
    db.pageOperationUpdates.toArray(),
    db.pageAmbiguities.toArray(),
    db.legacyOfflineBranches.toArray(),
  ]);
  let fileBytes = 0;
  let pageBytes = 0;
  for (const item of items) {
    if (item.kind === "file") {
      fileBytes += envelopeBytes(item.sealedFile);
      continue;
    }
    pageBytes += envelopeBytes(item.sealedPageBody);
  }
  pageBytes += states.reduce((total, row) => total + envelopeBytes(row.sealedState), 0);
  pageBytes += updates.reduce((total, row) => total + envelopeBytes(row.sealedBody), 0);
  pageBytes += ambiguities.reduce((total, row) => total + envelopeBytes(row.sealedDetails), 0);
  pageBytes += branches.reduce((total, row) => total + envelopeBytes(row.sealedBranch), 0);
  const queued = await db.outbox.count();
  return [
    { label: "Files held on this device", bytes: fileBytes },
    { label: "Page content", bytes: pageBytes },
    // Counted as an entry rather than as bytes: what an owner needs to know
    // about queued work is that it exists and will never be released, not how
    // large it is.
    { label: `Changes waiting to be sent (${queued})`, bytes: 0 },
  ];
}

/**
 * Releases what may be released, if anything must be.
 *
 * Returns what it released so the interface can say so: FR-018 requires
 * offloading to be visible, and an eviction nobody can see is one an owner
 * experiences as content vanishing.
 */
export async function runEviction(
  db: LocalDatabase,
  measurement: StorageMeasurement,
  codec?: LocalRecordCodec,
): Promise<{ readonly released: readonly string[]; readonly stillOverLimit: boolean }> {
  const candidates = await candidatesFrom(db, codec);
  const plan = planEviction({
    candidates,
    usedBytes: measurement.usedBytes,
    limitBytes: measurement.limitBytes,
  });
  const released: string[] = [];
  let releasedBytes = 0;
  for (const candidate of plan.release) {
    const didRelease = await db.transaction(
      "rw",
      [
        db.items,
        db.pageOperationStates,
        db.pageOperationUpdates,
        db.pageAmbiguities,
        db.legacyOfflineBranches,
      ],
      async () => {
        const row = await db.items.get(candidate.itemId as never);
        if (row === undefined || row.localAvailability !== "present") return false;
        if (row.kind === "page") {
          const [updates, ambiguities, branch] = await Promise.all([
            db.pageOperationUpdates.where("pageId").equals(row.id).toArray(),
            db.pageAmbiguities.where("pageId").equals(row.id).toArray(),
            db.legacyOfflineBranches.get(row.id),
          ]);
          if (
            updates.some(({ status }) => status !== "accepted") ||
            ambiguities.some(({ status }) => status === "open") ||
            (branch !== undefined && branch.status !== "converted")
          ) {
            return false;
          }
          await db.pageOperationStates.delete(row.id);
          if (updates.length > 0) {
            await db.pageOperationUpdates.bulkDelete(updates.map(({ updateId }) => updateId));
          }
          if (ambiguities.length > 0) {
            await db.pageAmbiguities.bulkDelete(ambiguities.map(({ ambiguityId }) => ambiguityId));
          }
          if (branch !== undefined) await db.legacyOfflineBranches.delete(row.id);
        }
        // Content released, title and metadata kept (FR-018). The row stays,
        // so the owner still sees the item and can download it again.
        await db.items.put({
          ...row,
          sealedPageBody: null,
          sealedFile: null,
          localAvailability: "offloaded",
        });
        return true;
      },
    );
    if (didRelease) {
      released.push(candidate.itemId);
      releasedBytes += candidate.byteLength;
    }
  }
  return {
    released,
    stillOverLimit:
      measurement.limitBytes !== null &&
      measurement.usedBytes - releasedBytes > measurement.limitBytes,
  };
}

/**
 * Describes what this device holds, in the terms the eviction rule needs.
 *
 * `recoverable` is the field that decides everything, so it is computed
 * conservatively: an item is recoverable only when nothing about it is waiting
 * to be sent. Anything queued, and anything in conflict, is treated as
 * irreplaceable — being wrong in that direction costs disk space, and being
 * wrong the other way costs the owner their work.
 */
async function candidatesFrom(
  db: LocalDatabase,
  codec?: LocalRecordCodec,
): Promise<EvictionCandidate[]> {
  const queued = new Set<string>();
  const outbox = new Outbox(db, codec);
  for (const row of await outbox.all()) {
    const payload = row.payload as { itemId?: unknown };
    if (typeof payload.itemId === "string") {
      queued.add(payload.itemId);
    }
  }
  for (const row of await outbox.conflicts()) {
    const payload = row.payload as { itemId?: unknown };
    if (typeof payload.itemId === "string") {
      queued.add(payload.itemId);
    }
  }

  const [items, states, updates, ambiguities, branches] = await Promise.all([
    db.items.toArray(),
    db.pageOperationStates.toArray(),
    db.pageOperationUpdates.toArray(),
    db.pageAmbiguities.toArray(),
    db.legacyOfflineBranches.toArray(),
  ]);
  const unsafeOperationalPages = new Set<string>();
  for (const row of updates) {
    if (row.status !== "accepted") unsafeOperationalPages.add(row.pageId);
  }
  for (const row of ambiguities) {
    if (row.status === "open") unsafeOperationalPages.add(row.pageId);
  }
  for (const row of branches) {
    if (row.status !== "converted") unsafeOperationalPages.add(row.pageId);
  }
  const operationalBytes = new Map<string, number>();
  const addOperationalBytes = (pageId: string, bytes: number): void => {
    operationalBytes.set(pageId, (operationalBytes.get(pageId) ?? 0) + bytes);
  };
  for (const row of states) addOperationalBytes(row.pageId, envelopeBytes(row.sealedState));
  for (const row of updates) addOperationalBytes(row.pageId, envelopeBytes(row.sealedBody));
  for (const row of ambiguities) addOperationalBytes(row.pageId, envelopeBytes(row.sealedDetails));
  for (const row of branches) addOperationalBytes(row.pageId, envelopeBytes(row.sealedBranch));
  return items
    .filter((item) => item.localAvailability === "present")
    .map((item) => ({
      itemId: item.id,
      byteLength:
        envelopeBytes(item.sealedFile) +
        envelopeBytes(item.sealedPageBody) +
        (operationalBytes.get(item.id) ?? 0),
      // No access log yet, so ordering falls back to identity, which is
      // creation order for UUIDv7 — oldest first, which is the intended
      // direction. Replaced by a real timestamp when one exists.
      lastAccessedAt: 0,
      recoverable: !queued.has(item.id) && !unsafeOperationalPages.has(item.id),
      offlineIntent: item.offlineIntent,
      kind: item.kind === "file" ? "file-content" : "page-content",
    }));
}
