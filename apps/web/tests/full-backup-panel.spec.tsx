// @vitest-environment jsdom
import type { FullBackupStatus } from "@myownnotion/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullBackupPanel } from "../src/features/backup/full-backup-panel.tsx";

const verifiedStatus = {
  lastVerifiedAt: "2026-09-12T02:00:00.000Z",
  lastVerifiedBackupId: "018f47aa-55a4-7ed9-a170-56bfa7b0999d",
  sourceVersion: "0.1.0",
  sourceVersionLabel: "V0 (0.1.0)",
  remote: "verified",
  remoteVerifiedAt: "2026-09-12T02:05:00.000Z",
  latestAttemptAt: "2026-09-12T02:00:00.000Z",
  latestAttemptOutcome: "succeeded",
  lastRehearsalAt: "2026-07-01T02:00:00.000Z",
  lastRehearsalOutcome: "succeeded",
  stale: false,
  rehearsalDue: true,
} satisfies FullBackupStatus;

describe("full backup restore rehearsal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(status: FullBackupStatus) {
    const load = vi.fn().mockResolvedValue(status);
    const runRehearsal = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<FullBackupPanel load={load} runRehearsal={runRehearsal} />));
    return { load, runRehearsal };
  }

  it("invites the user to rehearse a verified backup when the monthly test is due", async () => {
    const { load } = await render(verifiedStatus);

    expect(load).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="full-backup-rehearsal-due"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="run-full-rehearsal"]')?.disabled,
    ).toBe(false);
  });

  it("omits the invitation while the monthly rehearsal is current", async () => {
    await render({ ...verifiedStatus, rehearsalDue: false });

    expect(container.querySelector('[data-testid="full-backup-rehearsal-due"]')).toBeNull();
  });

  it("explains why a due rehearsal cannot start before a verified backup exists", async () => {
    await render({
      ...verifiedStatus,
      lastVerifiedAt: null,
      lastVerifiedBackupId: null,
      sourceVersion: null,
      sourceVersionLabel: "V0",
      stale: true,
    });

    expect(
      container.querySelector('[data-testid="full-backup-rehearsal-due"]')?.textContent,
    ).toContain("Une sauvegarde complète vérifiée sera nécessaire");
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="run-full-rehearsal"]')?.disabled,
    ).toBe(true);
  });
});
