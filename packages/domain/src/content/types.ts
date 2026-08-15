/**
 * Canonical content primitives (T010).
 *
 * These types define the owned vocabulary shared by the server, the browser
 * projection, and future clients. Names and paths are display properties;
 * identity is always a UUIDv7.
 */
import type { Uuid } from "../ids/uuid.ts";

export const ITEM_KINDS = ["page", "folder", "file"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const LIFECYCLES = ["active", "trashed", "purged"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const PLACEMENT_KINDS = ["hierarchy", "attachment"] as const;
export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

/** Trash retention window (FR-013). */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Superseded revision snapshot retention window (FR-026). */
export const REVISION_SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Canonical page document format for this feature slice. */
export const PAGE_DOCUMENT_FORMAT = "myownnotion.document+json";

export interface PageDocument {
  readonly format: typeof PAGE_DOCUMENT_FORMAT;
  readonly formatVersion: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface CanonicalItem {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly kind: ItemKind;
  readonly name: string;
  readonly lifecycle: Lifecycle;
  readonly trashedAt: string | null;
  readonly purgeAfter: string | null;
  readonly currentRevisionId: Uuid;
}

export interface Placement {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly itemId: Uuid;
  /**
   * Whether the placed item is a file — not which kind it is.
   *
   * The cardinality rules only ever ask this question: an attachment must be a
   * file, and a non-file has exactly one hierarchy placement. Carrying the full
   * kind meant carrying a value that changes when a page becomes a folder,
   * which is what made conversion impossible (feature 004). File-ness never
   * changes, so this one is safe to denormalise.
   */
  readonly itemIsFile: boolean;
  readonly kind: PlacementKind;
  /** `null` means the workspace root (hierarchy placements only). */
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
  readonly removedAt: string | null;
}

export interface Relationship {
  readonly id: Uuid;
  readonly workspaceId: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Safe machine-readable error codes. Codes never contain private content and
 * are the only diagnostic vocabulary exposed to transports and logs.
 */
export const SAFE_ERROR_CODES = [
  "validation.invalid-identifier",
  "validation.invalid-name",
  "validation.invalid-kind",
  "validation.invalid-payload",
  "validation.unknown-format-version",
  "containment.parent-not-found",
  "containment.parent-not-container",
  "containment.file-cannot-contain",
  "containment.attachment-parent-must-be-page",
  "containment.cycle-rejected",
  "item.not-found",
  "item.not-active",
  "item.not-trashed",
  "item.wrong-kind",
  "placement.not-found",
  "placement.already-removed",
  "placement.cardinality-violation",
  "relationship.not-found",
  "relationship.endpoint-unavailable",
  "revision.not-found",
  "revision.snapshot-expired",
  "revision.stale-base",
  "mutation.duplicate",
  "mutation.conflict",
  "mutation.rejected",
  "storage.quota-exceeded",
  "storage.unavailable",
  "cursor.compacted",
  "resource.limit-exceeded",
  "internal.unexpected",
] as const;

export type SafeErrorCode = (typeof SAFE_ERROR_CODES)[number];

/**
 * Narrows an untrusted string to a known safe error code. Persisted failure
 * codes and codes crossing the API boundary are plain strings, so they must be
 * validated rather than asserted before being surfaced again.
 */
export function isSafeErrorCode(value: unknown): value is SafeErrorCode {
  return typeof value === "string" && (SAFE_ERROR_CODES as ReadonlyArray<string>).includes(value);
}

export interface SafeError {
  readonly code: SafeErrorCode;
  /** Human-oriented but content-free summary. */
  readonly title: string;
  readonly invalidFields?: ReadonlyArray<{ readonly field: string; readonly code: string }>;
  /** Competing revision identities for concurrency conflicts. */
  readonly competingRevisionIds?: ReadonlyArray<Uuid>;
}

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SafeError };

export function ok<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: SafeErrorCode,
  title: string,
  extra?: Partial<Omit<SafeError, "code" | "title">>,
): DomainResult<T> {
  return { ok: false, error: { code, title, ...extra } };
}

/** Validates and normalizes a display name (trimmed, non-empty, ≤512 chars). */
export function normalizeDisplayName(raw: string): DomainResult<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return err("validation.invalid-name", "Display name must not be empty");
  }
  if (trimmed.length > 512) {
    return err("validation.invalid-name", "Display name exceeds 512 characters");
  }
  return ok(trimmed);
}

/**
 * Containment matrix (FR-003..FR-006).
 * `parentKind === null` represents the workspace root.
 */
export function canContain(
  parentKind: ItemKind | null,
  childKind: ItemKind,
  placementKind: PlacementKind,
): boolean {
  if (placementKind === "attachment") {
    // Only pages own attachment collections; only files can be attached.
    return parentKind === "page" && childKind === "file";
  }
  // Hierarchy: root, pages, and folders may contain anything; files never contain.
  return parentKind === null || parentKind === "page" || parentKind === "folder";
}
