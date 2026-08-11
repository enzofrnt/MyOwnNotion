/**
 * First-run owner setup (T033, feature 002).
 *
 * The page an installation shows before it has an owner. It has to be usable
 * by exactly one person, once, under stress — the failure mode that matters is
 * an owner who finishes setup without a recovery kit they can actually reach.
 *
 * Two properties shape the whole component:
 *
 *   - **Nothing here is resumable across a reload.** The capability lives in
 *     memory only, so a refresh abandons the attempt and starts a new one. The
 *     page says so plainly rather than appearing to resume and then failing at
 *     the last step. Persisting it would mean writing a bootstrap authority
 *     into browser storage, which outlives the attempt by design.
 *   - **`ownerCount` is rendered, not assumed.** It comes from the server on
 *     every step and is displayed, so a regression that created an owner
 *     early is visible on screen rather than only in the database.
 */

import type { BootstrapProgressDto, InstallationStatusDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { newClientNonce, SecurityApi } from "../../services/security-api.ts";
import { RecoveryKitPanel, saveKitBlob } from "../security/recovery-kit-panel.tsx";
import { createOwnerPasskey, type PasskeyFailure, passkeysAvailable } from "./passkey-client.ts";

type Stage = "loading" | "idle" | "verifying" | "kit" | "unavailable";

interface KitState {
  readonly attemptId: string;
  readonly kitId: string;
  readonly delivery: "downloadable" | "download-consumed";
  readonly downloadExpiresAt: string;
}

const PASSKEY_GUIDANCE: Record<PasskeyFailure, string> = {
  unsupported: "This browser cannot create a passkey. Try a current Firefox, Chrome, or Safari.",
  cancelled: "The passkey prompt closed before it finished. Start it again when you are ready.",
  "already-registered": "This device already holds a passkey for this installation.",
  "insecure-context":
    "Passkeys need a secure context. Reach this installation over HTTPS, or over localhost.",
  failed: "The passkey could not be created. Try again.",
};

/**
 * Reads the delivery state from the progress variant rather than from a
 * separate field, so a `download-consumed` attempt cannot be rendered as still
 * downloadable.
 */
function toKitState(attemptId: string, progress: BootstrapProgressDto): KitState {
  return {
    attemptId,
    kitId: progress.recoveryKitId,
    delivery:
      progress.bootstrapState === "download-consumed" ? "download-consumed" : "downloadable",
    downloadExpiresAt: progress.downloadExpiresAt,
  };
}

export interface BootstrapPageProps {
  /** Injected in tests; defaults to the same-origin client. */
  readonly api?: SecurityApi;
  /** Called once the installation is ready, so the shell can move on. */
  readonly onReady?: () => void;
}

export function BootstrapPage(props: BootstrapPageProps) {
  const apiRef = useRef<SecurityApi>(props.api ?? new SecurityApi());
  const api = apiRef.current;

  const [stage, setStage] = useState<Stage>("loading");
  const [status, setStatus] = useState<InstallationStatusDto | null>(null);
  const [kit, setKit] = useState<KitState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async (): Promise<InstallationStatusDto | null> => {
    const result = await api.status();
    if (!result.ok) {
      setMessage("This installation is not answering. Check that the server is running.");
      setStage("unavailable");
      return null;
    }
    setStatus(result.value);
    return result.value;
  }, [api]);

  useEffect(() => {
    void (async () => {
      const current = await refreshStatus();
      if (current === null) {
        return;
      }
      if (current.ownerCount === 1) {
        // Someone else finished setup while this page was open. Hand straight
        // over rather than showing a completion panel for an attempt that was
        // not this one's.
        props.onReady?.();
        return;
      }
      setStage("idle");
    })();
  }, [refreshStatus, props.onReady]);

  const fail = useCallback((text: string) => {
    setMessage(text);
    setBusy(false);
  }, []);

  /** Claims the attempt and runs the passkey ceremony as one owner action. */
  const beginSetup = useCallback(async () => {
    setBusy(true);
    setMessage(null);

    if (!passkeysAvailable()) {
      setStage("idle");
      fail(PASSKEY_GUIDANCE[window.isSecureContext ? "unsupported" : "insecure-context"]);
      return;
    }

    const started = await api.start(newClientNonce());
    if (!started.ok) {
      // A claim conflict is the expected outcome of a second browser, not an
      // error to apologise for. Say what happened and what to do.
      fail(
        // `conflict` on the claim route can only mean one thing: another
        // attempt is already open. Nothing else on this route conflicts.
        started.problem.code === "conflict"
          ? "Another browser is already setting up this installation. Finish there, or reload here once it is done."
          : "Setup could not start. Reload the page and try again.",
      );
      await refreshStatus();
      return;
    }

    setStage("verifying");
    const ceremony = await createOwnerPasskey({
      challenge: started.value.challenge,
      relyingPartyId: window.location.hostname,
      relyingPartyName: "MyOwnNotion",
      userId: started.value.attemptId,
      userName: "Owner",
    });
    if (!ceremony.ok) {
      api.forget();
      setStage("idle");
      fail(PASSKEY_GUIDANCE[ceremony.failure]);
      return;
    }

    const verified = await api.verifyCredential(started.value.attemptId, ceremony.credential);
    if (!verified.ok) {
      api.forget();
      setStage("idle");
      fail(
        verified.problem.code === "authentication_failed"
          ? "The passkey was not accepted. Start setup again to get a fresh challenge."
          : "Setup could not continue. Start again.",
      );
      return;
    }

    setKit(toKitState(started.value.attemptId, verified.value));
    setStage("kit");
    setBusy(false);
  }, [api, fail, refreshStatus]);

  const downloadKit = useCallback(async () => {
    if (kit === null) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api.downloadKit(kit.attemptId);
    if (!result.ok) {
      fail(
        result.problem.code === "conflict" || result.problem.status === 410
          ? "That download is already spent. Generate a new kit to get another one."
          : "The kit could not be downloaded. Generate a new kit and try again.",
      );
      return;
    }
    // Straight from the response to the disk: never through state.
    saveKitBlob(result.value, "myownnotion-recovery.json");
    setKit({ ...kit, delivery: "download-consumed" });
    setBusy(false);
  }, [api, kit, fail]);

  const regenerateKit = useCallback(async () => {
    if (kit === null) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api.regenerateKit(kit.attemptId);
    if (!result.ok) {
      fail("A new kit could not be generated. Reload the page to start setup again.");
      return;
    }
    setKit({
      attemptId: kit.attemptId,
      kitId: result.value.recoveryKitId,
      delivery: "downloadable",
      downloadExpiresAt: result.value.downloadExpiresAt,
    });
    setMessage("A new kit is ready. The previous one no longer works.");
    setBusy(false);
  }, [api, kit, fail]);

  const confirmStorage = useCallback(async () => {
    if (kit === null) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api.confirmStorage(kit.attemptId);
    if (!result.ok) {
      fail("Setup could not be completed. Your installation still has no owner.");
      await refreshStatus();
      return;
    }
    setStatus((previous) =>
      previous === null
        ? previous
        : { ...previous, state: "ready", ownerCount: 1, workspaceCount: 1 },
    );
    setKit(null);
    setBusy(false);
    // No completion panel here: the shell swaps to the workspace as soon as an
    // owner exists, so anything rendered at this point would never be seen.
    // The owner's confirmation that setup worked is the workspace itself.
    props.onReady?.();
  }, [api, kit, fail, refreshStatus, props.onReady]);

  return (
    <main className="bootstrap-page" aria-labelledby="bootstrap-heading">
      <h1 id="bootstrap-heading">Set up this installation</h1>

      <p className="bootstrap-counts" data-testid="owner-counts">
        Owners: <strong data-testid="owner-count">{status?.ownerCount ?? 0}</strong> · Workspaces:{" "}
        <strong data-testid="workspace-count">{status?.workspaceCount ?? 0}</strong>
      </p>

      {/* One live region for the whole page: a screen reader hears each
          outcome once, in the order it happened, rather than competing
          announcements from separate regions. */}
      <p
        className="bootstrap-message"
        role="status"
        aria-live="polite"
        data-testid="bootstrap-message"
      >
        {message ?? ""}
      </p>

      {stage === "loading" ? (
        <p data-testid="bootstrap-loading">Checking this installation…</p>
      ) : null}

      {stage === "unavailable" ? (
        <p data-testid="bootstrap-unavailable">
          This installation is not answering. Nothing has been changed.
        </p>
      ) : null}

      {stage === "idle" ? (
        <section aria-labelledby="bootstrap-start-heading">
          <h2 id="bootstrap-start-heading">Create the owner passkey</h2>
          <p>
            This installation has no owner yet. Creating the passkey and saving the recovery kit
            takes about a minute, and it has to be finished in one go — reloading this page starts
            over.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void beginSetup();
            }}
            disabled={busy}
            data-testid="begin-setup"
          >
            Create owner passkey
          </button>
        </section>
      ) : null}

      {stage === "verifying" ? (
        <p data-testid="bootstrap-verifying">Waiting for your device to confirm the passkey…</p>
      ) : null}

      {stage === "kit" && kit !== null ? (
        <RecoveryKitPanel
          kitId={kit.kitId}
          delivery={kit.delivery}
          downloadExpiresAt={kit.downloadExpiresAt}
          busy={busy}
          onDownload={downloadKit}
          onRegenerate={regenerateKit}
          onConfirm={confirmStorage}
        />
      ) : null}
    </main>
  );
}
