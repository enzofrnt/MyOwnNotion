/**
 * Canonical identity manifest (T018, feature 002).
 *
 * Feature 001 owns the workspace, item, revision, mutation, and file-content
 * identities. Every security operation — encryption migration, key rotation,
 * recovery into a replacement installation — must carry those identities
 * across unchanged. A manifest digest turns that requirement into something a
 * test can assert in one comparison instead of diffing thousands of rows.
 *
 * The digest is deliberately order-independent and duplicate-sensitive: IDs are
 * sorted before hashing, so a query returning rows in a different order does
 * not look like corruption, while a lost, added, or duplicated ID does.
 *
 * A matching digest proves the *identity set* survived. It says nothing about
 * content, which authenticated envelopes cover separately.
 */
import { sha256, toBase64Url } from "./crypto.ts";

/** The identity collections a manifest covers, in canonical order. */
export const IDENTITY_COLLECTIONS = [
  "workspaces",
  "items",
  "revisions",
  "mutations",
  "fileContents",
] as const;
export type IdentityCollection = (typeof IDENTITY_COLLECTIONS)[number];

export type CanonicalIdentitySets = {
  readonly [K in IdentityCollection]: readonly string[];
};

export interface IdentityManifest {
  readonly digest: string;
  /** Row count per collection, so a diff can report *where* it changed. */
  readonly counts: Record<IdentityCollection, number>;
  readonly sets: CanonicalIdentitySets;
}

function normalize(ids: readonly string[]): string[] {
  // Sorted, but not deduplicated: a duplicate ID is corruption and must change
  // the digest rather than being quietly absorbed.
  return [...ids].sort();
}

/**
 * Builds a manifest.
 *
 * The canonical serialization uses a collection separator and a record
 * separator that cannot appear in a UUID, so no rearrangement of IDs across
 * collection boundaries can produce a colliding digest.
 */
export function buildIdentityManifest(sets: CanonicalIdentitySets): IdentityManifest {
  const normalized = Object.fromEntries(
    IDENTITY_COLLECTIONS.map((collection) => [collection, normalize(sets[collection])]),
  ) as { [K in IdentityCollection]: string[] };

  const canonical = IDENTITY_COLLECTIONS.map(
    (collection) => `${collection}${normalized[collection].join("")}`,
  ).join("");

  return {
    digest: toBase64Url(sha256(canonical)),
    counts: Object.fromEntries(
      IDENTITY_COLLECTIONS.map((collection) => [collection, normalized[collection].length]),
    ) as Record<IdentityCollection, number>,
    sets: normalized,
  };
}

export interface IdentityDrift {
  readonly collection: IdentityCollection;
  readonly kind: "missing" | "unexpected";
  readonly id: string;
}

/**
 * Every identity that disappeared or appeared between two manifests.
 *
 * An empty array is the assertion a security operation must satisfy: the
 * feature-001 identity set is byte-for-byte the same set it started with.
 */
export function diffIdentityManifests(
  before: IdentityManifest,
  after: IdentityManifest,
): IdentityDrift[] {
  if (before.digest === after.digest) {
    return [];
  }
  const drift: IdentityDrift[] = [];
  for (const collection of IDENTITY_COLLECTIONS) {
    const previous = new Set(before.sets[collection]);
    const current = new Set(after.sets[collection]);
    for (const id of previous) {
      if (!current.has(id)) {
        drift.push({ collection, kind: "missing", id });
      }
    }
    for (const id of current) {
      if (!previous.has(id)) {
        drift.push({ collection, kind: "unexpected", id });
      }
    }
  }
  return drift;
}

export class IdentityPreservationError extends Error {
  constructor(readonly drift: readonly IdentityDrift[]) {
    const summary = drift
      .slice(0, 5)
      .map((entry) => `${entry.collection}: ${entry.kind} ${entry.id}`)
      .join("; ");
    super(
      `canonical feature-001 identities changed (${drift.length} difference(s)): ${summary}` +
        (drift.length > 5 ? " …" : ""),
    );
    this.name = "IdentityPreservationError";
  }
}

/**
 * Throws unless the identity set is unchanged. Used at the end of a migration,
 * a rotation, or a recovery adoption.
 */
export function assertIdentitiesPreserved(before: IdentityManifest, after: IdentityManifest): void {
  const drift = diffIdentityManifests(before, after);
  if (drift.length > 0) {
    throw new IdentityPreservationError(drift);
  }
}

/**
 * Digest of a *subset* of collections, for a checkpoint that has only
 * processed part of the workspace. Collections not named are treated as empty
 * rather than omitted, so a partial digest can never equal a full one.
 */
export function partialIdentityDigest(sets: Partial<CanonicalIdentitySets>): string {
  const complete = Object.fromEntries(
    IDENTITY_COLLECTIONS.map((collection) => [collection, sets[collection] ?? []]),
  ) as CanonicalIdentitySets;
  return buildIdentityManifest(complete).digest;
}
