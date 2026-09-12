/**
 * The six checks before a destructive restoration (T022, FR-015 to FR-017).
 *
 * Every test here is about *not writing*. A restoration that discovers a problem
 * halfway is the state FR-017 spends its whole effort making survivable, so the
 * cheapest way to honour FR-017 is to reach it rarely — which is what these
 * checks are for.
 *
 * The ordering assertions matter as much as the individual refusals.
 * Confirmation is last on purpose: asking first and checking afterwards trains
 * somebody to confirm before they have been told anything, and the confirmation
 * then means nothing.
 */

import { createHash } from "node:crypto";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type BackupManifest } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { encodeUncheckedBackupArchive } from "../src/backup/archive-format.ts";
import {
  applyArchive,
  PREFLIGHT_ORDER,
  type PreflightInput,
  preflight,
} from "../src/backup/restore-service.ts";

const DIGEST = `sha256:${createHash("sha256").update("abc").digest("hex")}`;
const TEST_WORKSPACE = "00000000-0000-7000-8000-000000000001";
const TEST_ITEM = "00000000-0000-7000-8000-000000000002";
const TEST_REVISION = "00000000-0000-7000-8000-000000000003";
const TEST_MUTATION = "00000000-0000-7000-8000-000000000004";
const TEST_RELATIONSHIP = "00000000-0000-7000-8000-000000000005";

/**
 * A well-formed archive, with the manifest merged rather than replaced.
 *
 * The first version of this helper spread the overrides at the top level *and*
 * inside the manifest, so passing one manifest field silently discarded every
 * other one — and three tests then asserted against an archive that was broken
 * for a reason they were not testing.
 */
function archive(
  manifestOverrides: Record<string, unknown> = {},
  includeFile = true,
  canonicalOverride?: string,
): Buffer {
  const canonicalExport =
    canonicalOverride ??
    JSON.stringify({
      format: "myownnotion.export+json",
      formatVersion: 2,
      workspaceId: TEST_WORKSPACE,
      schemaVersion: 1,
      exportedAt: "2026-08-18T04:00:00.000Z",
      changeCursor: "42",
      items: [
        {
          id: TEST_ITEM,
          workspaceId: TEST_WORKSPACE,
          kind: "file",
          name: "one",
          icon: null,
          lifecycle: "active",
          trashedAt: null,
          purgeAfter: null,
          currentRevisionId: TEST_REVISION,
          favourite: false,
          offlineIntent: false,
          pageDocument: null,
          file: {
            mediaType: "text/plain",
            originalName: "one.txt",
            byteLength: 3,
            sha256: DIGEST.slice("sha256:".length),
          },
          placements: [],
        },
      ],
      databases: [],
      databaseEntries: [],
      relationships: [],
      revisions: [
        {
          id: TEST_REVISION,
          itemId: TEST_ITEM,
          mutationId: TEST_MUTATION,
          parentRevisionIds: [],
          acceptedAt: "2026-08-18T04:00:00.000Z",
        },
      ],
      counts: {
        items: 1,
        activeItems: 1,
        trashedItems: 0,
        placements: 0,
        relationships: 0,
        revisions: 1,
        databases: 0,
        databaseEntries: 0,
      },
    });
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-08-18T04:00:00.000Z",
    cursor: "42",
    applicationVersion: "0.1.0",
    schemaVersion: 1,
    recordFormatVersion: 1,
    canonicalExportDigest: `sha256:${createHash("sha256").update(canonicalExport).digest("hex")}`,
    files: [{ digest: DIGEST, byteLength: 3 }],
    itemCount: 1,
    fileCount: 1,
    ...manifestOverrides,
  };
  return encodeUncheckedBackupArchive({
    manifest,
    canonicalExport,
    files: includeFile ? new Map([[DIGEST, Buffer.from("abc")]]) : new Map(),
  });
}

function input(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    openArchive: async () => archive(),
    installation: { schemaVersion: 1, recordFormatVersion: 1 },
    showScope: () => true,
    safetyBackup: async () => "safety-backup-id",
    confirm: () => true,
    kind: "destructive",
    ...overrides,
  };
}

describe("the order of the checks", () => {
  it("runs them in the order the requirement lists", () => {
    expect(PREFLIGHT_ORDER).toEqual([
      "key-access",
      "archive-integrity",
      "version-compatibility",
      "scope-shown",
      "safety-backup",
      "confirmation",
    ]);
  });

  it("never asks for confirmation before the checks that inform it", async () => {
    const order: string[] = [];
    const outcome = await preflight(
      input({
        showScope: () => {
          order.push("scope");
          return true;
        },
        safetyBackup: async () => {
          order.push("safety");
          return "id";
        },
        confirm: () => {
          order.push("confirm");
          return true;
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    // Asking first and checking afterwards trains somebody to confirm before
    // they have been told anything.
    expect(order).toEqual(["scope", "safety", "confirm"]);
  });
});

describe("each check refuses with what is missing", () => {
  it("stops at key access when the material is unavailable", async () => {
    const confirm = vi.fn(() => true);
    const outcome = await preflight(input({ openArchive: async () => null, confirm }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("key-access");
      // The failure an owner is most likely to be able to fix, so it says how.
      expect(outcome.reason).toMatch(/mount it/i);
      expect(outcome.reason).toMatch(/unchanged/i);
    }
    // Nothing after it ran.
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stops at integrity when the manifest is not valid", async () => {
    const outcome = await preflight(input({ openArchive: async () => archive({ fileCount: 9 }) }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("archive-integrity");
      expect(outcome.reason).toContain("fileCount");
    }
  });

  it("stops at integrity when a file the manifest lists is absent", async () => {
    const outcome = await preflight(
      input({
        openArchive: async () => archive({}, false),
      }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("archive-integrity");
      // Named as what it would produce, because that is the consequence an owner
      // is deciding about.
      expect(outcome.reason).toMatch(/holes in it/i);
    }
  });

  it("stops at compatibility when the backup is newer, naming both versions", async () => {
    const outcome = await preflight(
      input({
        installation: { schemaVersion: 1, recordFormatVersion: 1 },
        openArchive: async () => archive({ schemaVersion: 4 }),
      }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("version-compatibility");
      expect(outcome.reason).toContain("4");
      expect(outcome.reason).toContain("1");
    }
  });

  it("stops when a safety backup could not be taken", async () => {
    const confirm = vi.fn(() => true);
    const outcome = await preflight(input({ safetyBackup: async () => null, confirm }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("safety-backup");
      expect(outcome.reason).toMatch(/nothing to return to/i);
    }
    // And it never asked: consent to replace something irrecoverable is consent
    // obtained under a false premise.
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stops when the owner does not confirm", async () => {
    const outcome = await preflight(input({ confirm: () => false }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("confirmation");
      expect(outcome.reason).toMatch(/nothing was changed/i);
    }
  });
});

describe("a rehearsal", () => {
  it("needs no safety backup and no confirmation", async () => {
    const safetyBackup = vi.fn(async () => "id");
    const confirm = vi.fn(() => true);
    const outcome = await preflight(input({ kind: "test", safetyBackup, confirm }));
    expect(outcome.ok).toBe(true);
    // It replaces nothing, so the two steps that exist to protect what is being
    // replaced do not apply. Running them anyway would make the safe path the
    // tedious one — and the safe path has to be the easy one or nobody
    // rehearses.
    expect(safetyBackup).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("still checks the archive and the version", async () => {
    const outcome = await preflight(
      input({ kind: "test", openArchive: async () => archive({ schemaVersion: 9 }) }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failedAt).toBe("version-compatibility");
    }
  });
});

describe("writing a checked archive", () => {
  function markerArchive(formatVersion: 1 | 2, extra = false): Buffer {
    const marker = extra
      ? { $myownnotionProtected: 1, authored: true }
      : { $myownnotionProtected: 1 };
    const canonicalExport = JSON.stringify({
      format: "myownnotion.export+json",
      formatVersion: 2,
      workspaceId: TEST_WORKSPACE,
      schemaVersion: 1,
      exportedAt: "2026-08-18T04:00:00.000Z",
      changeCursor: "42",
      items: [
        {
          id: TEST_ITEM,
          workspaceId: TEST_WORKSPACE,
          kind: "page",
          name: "one",
          icon: null,
          lifecycle: "active",
          trashedAt: null,
          purgeAfter: null,
          currentRevisionId: TEST_REVISION,
          favourite: false,
          offlineIntent: false,
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: marker,
          },
          file: null,
          placements: [],
        },
      ],
      databases: [],
      databaseEntries: [],
      relationships: [
        {
          id: TEST_RELATIONSHIP,
          workspaceId: TEST_WORKSPACE,
          sourceItemId: TEST_ITEM,
          targetItemId: TEST_ITEM,
          relationType: "mention:reference",
          metadata: marker,
          createdRevisionId: TEST_REVISION,
          removedRevisionId: null,
        },
      ],
      revisions: [
        {
          id: TEST_REVISION,
          itemId: TEST_ITEM,
          mutationId: TEST_MUTATION,
          parentRevisionIds: [],
          acceptedAt: "2026-08-18T04:00:00.000Z",
        },
      ],
      counts: {
        items: 1,
        activeItems: 1,
        trashedItems: 0,
        placements: 0,
        relationships: 1,
        revisions: 1,
        databases: 0,
        databaseEntries: 0,
      },
    });
    return encodeUncheckedBackupArchive({
      manifest: {
        format: BACKUP_FORMAT,
        formatVersion,
        createdAt: "2026-08-18T04:00:00.000Z",
        cursor: "42",
        applicationVersion: "0.1.0",
        schemaVersion: 1,
        recordFormatVersion: 1,
        canonicalExportDigest: `sha256:${createHash("sha256").update(canonicalExport).digest("hex")}`,
        files: [],
        itemCount: 1,
        fileCount: 0,
      },
      canonicalExport,
      files: new Map(),
    });
  }

  it("refuses a reserved marker in a new archive before target mutation starts", async () => {
    const calls: string[] = [];
    await expect(
      applyArchive(markerArchive(BACKUP_FORMAT_VERSION), {
        begin: async () => {
          calls.push("begin");
        },
        writeFile: async () => {
          calls.push("file");
        },
        writeRevision: async () => {
          calls.push("revision");
        },
        writeItem: async () => {
          calls.push("item");
        },
        writeRelationship: async () => {
          calls.push("relationship");
        },
      }),
    ).rejects.toThrow(/reserved protected-content/i);
    expect(calls).toEqual([]);
  });

  it("refuses a malformed V1 canonical export before target mutation starts", async () => {
    const malformed = JSON.stringify({ items: [{}], relationships: [], revisions: [] });
    const calls: string[] = [];
    await expect(
      applyArchive(archive({ formatVersion: 1, itemCount: 1 }, true, malformed), {
        begin: async () => {
          calls.push("begin");
        },
        writeFile: async () => {
          calls.push("file");
        },
        writeRevision: async () => {
          calls.push("revision");
        },
        writeItem: async () => {
          calls.push("item");
        },
        writeRelationship: async () => {
          calls.push("relationship");
        },
      }),
    ).rejects.toThrow(/canonical export/i);
    expect(calls).toEqual([]);
  });

  it("keeps exact markers restorable from a pre-reservation archive", async () => {
    const written: unknown[] = [];
    await applyArchive(markerArchive(1), {
      begin: async () => {},
      writeFile: async () => {},
      writeRevision: async () => {},
      writeItem: async (item) => {
        written.push(item);
      },
      writeRelationship: async (relationship) => {
        written.push(relationship);
      },
    });
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      pageDocument: { body: { $myownnotionProtected: 1 } },
    });
    expect(written[1]).toMatchObject({ metadata: { $myownnotionProtected: 1 } });
  });

  it("accepts authored multi-key objects that contain the marker-shaped key", async () => {
    const calls: string[] = [];
    await applyArchive(markerArchive(BACKUP_FORMAT_VERSION, true), {
      begin: async () => {
        calls.push("begin");
      },
      writeFile: async () => {
        calls.push("file");
      },
      writeRevision: async () => {
        calls.push("revision");
      },
      writeItem: async () => {
        calls.push("item");
      },
      writeRelationship: async () => {
        calls.push("relationship");
      },
    });
    expect(calls).toEqual(["begin", "item", "revision", "relationship"]);
  });

  it("writes files before the items that name them", async () => {
    const order: string[] = [];
    await applyArchive(archive(), {
      writeFile: async () => {
        order.push("file");
      },
      writeRevision: async () => {
        order.push("revision");
      },
      writeItem: async () => {
        order.push("item");
      },
      writeRelationship: async () => {
        order.push("relationship");
      },
    });
    // An item naming a file the store does not hold is a broken reference the
    // moment it is written, and the window between the two is a window in which
    // an interrupted restore leaves exactly that.
    expect(order.indexOf("file")).toBeLessThan(order.indexOf("item"));
  });

  it("reports what it restored", async () => {
    const result = await applyArchive(archive(), {
      writeFile: async () => {},
      writeRevision: async () => {},
      writeItem: async () => {},
      writeRelationship: async () => {},
    });
    expect(result).toEqual({
      restoredItemCount: 1,
      restoredFileCount: 1,
      restoredDatabaseCount: 0,
      restoredDatabaseEntryCount: 0,
    });
  });
});
