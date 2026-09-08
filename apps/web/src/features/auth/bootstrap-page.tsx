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
import { AsyncState, Button, FR_COPY } from "../../ui/index.ts";
import { RecoveryKitPanel, saveKitBlob } from "../security/recovery-kit-panel.tsx";
import { DesktopPasskeyGuidance, useDesktopPlatformPasskey } from "./desktop-passkey-guidance.tsx";
import {
  createOwnerPasskey,
  type PasskeyFailure,
  passkeysAvailable,
  platformAuthenticatorAvailable,
} from "./passkey-client.ts";

type Stage = "loading" | "idle" | "verifying" | "kit" | "unavailable";

interface KitState {
  readonly attemptId: string;
  readonly kitId: string;
  readonly delivery: "downloadable" | "download-consumed";
  readonly downloadExpiresAt: string;
}

const PASSKEY_GUIDANCE: Record<PasskeyFailure, string> = {
  unsupported: FR_COPY.auth.passkey.unsupported,
  cancelled: FR_COPY.auth.passkey.cancelled,
  "already-registered": FR_COPY.auth.passkey.alreadyRegistered,
  "insecure-context": FR_COPY.auth.passkey.insecureContext,
  failed: FR_COPY.auth.passkey.failed,
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
  const desktopPlatformPasskey = useDesktopPlatformPasskey();

  const refreshStatus = useCallback(async (): Promise<InstallationStatusDto | null> => {
    const result = await api.status();
    if (!result.ok) {
      setMessage(FR_COPY.auth.bootstrap.unavailableServer);
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

    if (window.myownnotionDesktop?.platform === "darwin") {
      const platformReady = await platformAuthenticatorAvailable();
      if (!platformReady) {
        setStage("idle");
        fail(FR_COPY.auth.passkey.desktopUnavailable);
        return;
      }
    }

    const started = await api.start(newClientNonce());
    if (!started.ok) {
      // A claim conflict is the expected outcome of a second browser, not an
      // error to apologise for. Say what happened and what to do.
      fail(
        // `conflict` on the claim route can only mean one thing: another
        // attempt is already open. Nothing else on this route conflicts.
        started.problem.code === "conflict"
          ? FR_COPY.auth.bootstrap.anotherBrowser
          : FR_COPY.auth.bootstrap.startFailed,
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
      userName: FR_COPY.auth.passkey.ownerName,
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
          ? FR_COPY.auth.bootstrap.passkeyRejected
          : FR_COPY.auth.bootstrap.continueFailed,
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
          ? FR_COPY.auth.bootstrap.downloadConsumed
          : FR_COPY.auth.bootstrap.downloadFailed,
      );
      return;
    }
    // Straight from the response to the disk: never through state.
    try {
      const saved = await saveKitBlob(result.value, "myownnotion-recovery.json");
      if (!saved)
        setMessage("Enregistrement annulé. Régénérez le kit avant de confirmer sa conservation.");
    } catch {
      setMessage(
        "Le kit n’a pas pu être enregistré. Régénérez-le avant de confirmer sa conservation.",
      );
    }
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
      fail(FR_COPY.auth.bootstrap.regenerateFailed);
      return;
    }
    setKit({
      attemptId: kit.attemptId,
      kitId: result.value.recoveryKitId,
      delivery: "downloadable",
      downloadExpiresAt: result.value.downloadExpiresAt,
    });
    setMessage(FR_COPY.auth.bootstrap.regenerated);
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
      fail(FR_COPY.auth.bootstrap.completionFailed);
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
    <main className="bootstrap-page ui-auth-surface" aria-labelledby="bootstrap-heading">
      <h1 id="bootstrap-heading">{FR_COPY.auth.bootstrap.title}</h1>

      <p className="bootstrap-counts" data-testid="owner-counts">
        {FR_COPY.auth.bootstrap.owners} :{" "}
        <strong data-testid="owner-count">{status?.ownerCount ?? 0}</strong> ·{" "}
        {FR_COPY.auth.bootstrap.workspaces} :{" "}
        <strong data-testid="workspace-count">{status?.workspaceCount ?? 0}</strong>
      </p>

      {message === null ? null : (
        <AsyncState
          compact
          kind={busy ? "loading" : stage === "kit" ? "success" : "error"}
          title={message}
          testId="bootstrap-message"
        />
      )}

      {stage === "loading" ? (
        <AsyncState
          kind="loading"
          title={FR_COPY.auth.bootstrap.checking}
          testId="bootstrap-loading"
        />
      ) : null}

      {stage === "unavailable" ? (
        <AsyncState
          kind="error"
          title={FR_COPY.auth.bootstrap.unavailableTitle}
          description={FR_COPY.auth.bootstrap.unavailable}
          testId="bootstrap-unavailable"
        />
      ) : null}

      {stage === "idle" ? (
        desktopPlatformPasskey === false ? (
          <DesktopPasskeyGuidance testId="bootstrap-desktop-passkey-guidance" />
        ) : (
          <section className="ui-auth-card" aria-labelledby="bootstrap-start-heading">
            <h2 id="bootstrap-start-heading">{FR_COPY.auth.bootstrap.createTitle}</h2>
            <p>{FR_COPY.auth.bootstrap.createDescription}</p>
            <Button
              type="button"
              variant="primary"
              busy={busy || desktopPlatformPasskey === null}
              onClick={() => {
                void beginSetup();
              }}
              data-testid="begin-setup"
            >
              {FR_COPY.auth.bootstrap.createAction}
            </Button>
          </section>
        )
      ) : null}

      {stage === "verifying" ? (
        <AsyncState
          kind="loading"
          title={FR_COPY.auth.bootstrap.verifying}
          testId="bootstrap-verifying"
        />
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
