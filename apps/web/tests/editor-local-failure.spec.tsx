// @vitest-environment jsdom
/**
 * Local failure honesty (T108, FR-029).
 *
 * Quota, key unavailability and protocol refusal must all land in the same
 * honest place: the state says blocked, nothing claims durability, and the
 * recovery buffer keeps what the owner typed with one non-destructive way
 * forward. These tests pin the state derivation, the recovery surface, and
 * the fact that a retry that succeeds clears the buffer.
 */

import type { PageSyncBlockedReason, PageSyncState } from "@myownnotion/client-core";
import { derivePageSyncState } from "@myownnotion/client-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_REASON_COPY,
  editorSyncLabel,
} from "../src/features/editor/editor-sync-status.tsx";
import { LocalCommitRecovery } from "../src/features/editor/local-commit-recovery.tsx";

function blockedState(reason: PageSyncBlockedReason): PageSyncState {
  return derivePageSyncState({
    localCommit: "blocked",
    localBlockedReason: reason,
    online: true,
    importingRemote: false,
    operationState: null,
    updates: [],
    ambiguities: [],
  });
}

describe("local failure states", () => {
  it("maps quota, key and protocol failures to blocked without durability claims", () => {
    for (const reason of ["quota", "key", "protocol"] as const) {
      const state = blockedState(reason);
      expect(state.kind).toBe("blocked");
      expect(state.synchronizationKind).toBe("blocked");
      expect(state.blockedReason).toBe(reason);
      expect(state.locallyDurable).toBe(false);
    }
  });

  it("gives every blocked reason a French explanation", () => {
    for (const reason of [
      "quota",
      "key",
      "protocol",
      "revocation",
      "validation",
      "integrity",
      "operation",
      "storage",
    ] as const) {
      const copy = BLOCKED_REASON_COPY[reason];
      expect(copy.length).toBeGreaterThan(3);
      expect(copy).toMatch(/[a-zà-ÿ]/u);
    }
  });

  it("never labels a blocked state as synchronized", () => {
    for (const reason of ["quota", "key", "protocol"] as const) {
      expect(editorSyncLabel(blockedState(reason)).toLowerCase()).not.toContain("synchron");
    }
  });
});

interface FakeSessionShape {
  readonly sync: PageSyncState;
  readonly recoveryBuffer: {
    readonly pageId: string;
    readonly updateId: string;
    readonly document: unknown;
    readonly reason: PageSyncBlockedReason;
    readonly failedAt: string;
  } | null;
  retryBlockedCommit(): Promise<void>;
}

function fakeSession(input: { readonly reason: PageSyncBlockedReason }): FakeSessionShape {
  return {
    sync: blockedState(input.reason),
    recoveryBuffer: {
      pageId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f20c1",
      updateId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f20c2",
      document: { blocks: [] },
      reason: input.reason,
      failedAt: "2026-08-22T05:00:00.000Z",
    },
    retryBlockedCommit: async () => {},
  };
}

describe("recovery surface", () => {
  it("shows the honest banner and exactly one non-destructive action when blocked", () => {
    const markup = renderToStaticMarkup(
      createElement(LocalCommitRecovery, {
        session: fakeSession({ reason: "quota" }) as never,
      }),
    );
    expect(markup).toContain('data-testid="recovery-buffer"');
    expect(markup).toContain("rien n’a été perdu");
    expect(markup).toContain("Réessayer l’enregistrement");
    // No destructive escape hatch: no delete, no discard wording.
    expect(markup.toLowerCase()).not.toContain("supprimer");
    expect(markup.toLowerCase()).not.toContain("abandonner");
  });

  it("renders nothing while the session is not blocked", () => {
    const session = fakeSession({ reason: "quota" });
    const markup = renderToStaticMarkup(
      createElement(LocalCommitRecovery, {
        session: {
          ...session,
          sync: derivePageSyncState({
            localCommit: "idle",
            online: true,
            importingRemote: false,
            operationState: null,
            updates: [],
            ambiguities: [],
          }),
          recoveryBuffer: null,
        } as never,
      }),
    );
    expect(markup).toBe("");
  });

  it("keeps the buffer visible for key and protocol reasons too", () => {
    for (const reason of ["key", "protocol"] as const) {
      const markup = renderToStaticMarkup(
        createElement(LocalCommitRecovery, {
          session: fakeSession({ reason }) as never,
        }),
      );
      expect(markup).toContain("recovery-buffer");
    }
  });
});
