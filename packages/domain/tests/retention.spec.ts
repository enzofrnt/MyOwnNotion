/**
 * Snapshot retention and restore-as-new-descendant rules (T083, US5).
 *
 * Superseded content stays complete for 24 hours (FR-026) and only becomes
 * prunable when nothing else still needs it. Restoration never rewrites
 * ancestry: it plans a new revision parented on the actual current head, and a
 * stale expected head must surface as an explicit conflict (FR-015/FR-027).
 */

import {
  asChangeCursor,
  canPruneSnapshot,
  generateUuidV7,
  INITIAL_CHANGE_CURSOR,
  planRestoreRevision,
  REVISION_SNAPSHOT_RETENTION_MS,
  type RevisionWithSnapshot,
  snapshotExpiry,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const SUPERSEDED_AT = new Date("2026-08-09T12:00:00.000Z");
const EXPIRES_AT = new Date(SUPERSEDED_AT.getTime() + REVISION_SNAPSHOT_RETENTION_MS);

const UNPROTECTED = {
  isCurrentHead: false,
  isConflictProtected: false,
  isRetentionProtected: false,
} as const;

function revision(overrides: Partial<RevisionWithSnapshot> = {}): RevisionWithSnapshot {
  return {
    id: generateUuidV7(),
    itemId: generateUuidV7(),
    mutationId: generateUuidV7(),
    parentRevisionIds: [],
    acceptedAt: SUPERSEDED_AT.toISOString(),
    snapshot: { body: { text: "retained" } },
    snapshotExpiresAt: EXPIRES_AT.toISOString(),
    ...overrides,
  };
}

describe("snapshotExpiry", () => {
  it("is exactly 24 hours after the content was superseded", () => {
    expect(snapshotExpiry(SUPERSEDED_AT).toISOString()).toBe(
      new Date("2026-08-10T12:00:00.000Z").toISOString(),
    );
  });
});

describe("canPruneSnapshot", () => {
  it("keeps content throughout the 24-hour window", () => {
    const oneMsEarly = () => new Date(EXPIRES_AT.getTime() - 1);
    expect(canPruneSnapshot(revision(), UNPROTECTED, oneMsEarly)).toBe(false);
  });

  it("allows pruning once the window has elapsed", () => {
    expect(canPruneSnapshot(revision(), UNPROTECTED, () => EXPIRES_AT)).toBe(true);
  });

  it("never prunes an already pruned snapshot", () => {
    expect(canPruneSnapshot(revision({ snapshot: null }), UNPROTECTED, () => EXPIRES_AT)).toBe(
      false,
    );
  });

  it("never prunes a revision with no recorded expiry", () => {
    expect(
      canPruneSnapshot(revision({ snapshotExpiresAt: null }), UNPROTECTED, () => EXPIRES_AT),
    ).toBe(false);
  });

  it("never prunes the current head", () => {
    expect(
      canPruneSnapshot(revision(), { ...UNPROTECTED, isCurrentHead: true }, () => EXPIRES_AT),
    ).toBe(false);
  });

  it("never prunes content an unresolved conflict still needs", () => {
    expect(
      canPruneSnapshot(revision(), { ...UNPROTECTED, isConflictProtected: true }, () => EXPIRES_AT),
    ).toBe(false);
  });

  it("never prunes content trash or backup rules still need", () => {
    expect(
      canPruneSnapshot(
        revision(),
        { ...UNPROTECTED, isRetentionProtected: true },
        () => EXPIRES_AT,
      ),
    ).toBe(false);
  });

  it("uses the real clock when no clock is supplied", () => {
    const longExpired = revision({ snapshotExpiresAt: "2000-01-01T00:00:00.000Z" });
    const farFuture = revision({ snapshotExpiresAt: "2999-01-01T00:00:00.000Z" });
    expect(canPruneSnapshot(longExpired, UNPROTECTED)).toBe(true);
    expect(canPruneSnapshot(farFuture, UNPROTECTED)).toBe(false);
  });
});

describe("planRestoreRevision", () => {
  it("parents the restoration on the actual current head instead of rewriting history", () => {
    const source = revision();
    const head = generateUuidV7();

    const result = planRestoreRevision(source, head, {
      revisionId: source.id,
      expectedCurrentRevisionId: head,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parentRevisionId).toBe(head);
      expect(result.value.restoredSnapshot).toEqual(source.snapshot);
      expect(result.value.sourceRevision.id).toBe(source.id);
    }
  });

  it("rejects an unknown revision", () => {
    const result = planRestoreRevision(null, generateUuidV7(), {
      revisionId: generateUuidV7(),
      expectedCurrentRevisionId: generateUuidV7(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("revision.not-found");
    }
  });

  it("rejects restoring content that has already expired", () => {
    const source = revision({ snapshot: null });
    const head = generateUuidV7();

    const result = planRestoreRevision(source, head, {
      revisionId: source.id,
      expectedCurrentRevisionId: head,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("revision.snapshot-expired");
    }
  });

  it("reports a conflict with the competing head when the expected head is stale", () => {
    const source = revision();
    const actualHead = generateUuidV7();

    const result = planRestoreRevision(source, actualHead, {
      revisionId: source.id,
      expectedCurrentRevisionId: generateUuidV7(), // the owner's stale belief
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("mutation.conflict");
      expect(result.error.competingRevisionIds).toEqual([actualHead]);
    }
  });
});

describe("change cursors", () => {
  it("treats the empty cursor as the beginning of history", () => {
    expect(INITIAL_CHANGE_CURSOR).toBe("");
  });

  it("brands an opaque cursor value without altering it", () => {
    expect(asChangeCursor("seq:42")).toBe("seq:42");
  });
});
