/**
 * First-run owner setup (T033 / T140, feature 002).
 *
 * Operator flow: open → create passkey → create password → confirm. Done.
 * Recovery-kit download stays in settings after the installation is ready.
 *
 * Nothing here is resumable across a reload: the capability lives in memory
 * only, so a refresh abandons the attempt and starts a new one.
 */

import type { InstallationStatusDto } from "@myownnotion/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { newClientNonce, SecurityApi } from "../../services/security-api.ts";
import { AsyncState, Button, FR_COPY } from "../../ui/index.ts";
import { DesktopPasskeyGuidance, useDesktopPlatformPasskey } from "./desktop-passkey-guidance.tsx";
import {
  createOwnerPasskey,
  type PasskeyFailure,
  passkeysAvailable,
  platformAuthenticatorAvailable,
} from "./passkey-client.ts";

type Stage = "loading" | "idle" | "verifying" | "password" | "unavailable";

const PASSKEY_GUIDANCE: Record<PasskeyFailure, string> = {
  unsupported: FR_COPY.auth.passkey.unsupported,
  cancelled: FR_COPY.auth.passkey.cancelled,
  "already-registered": FR_COPY.auth.passkey.alreadyRegistered,
  "insecure-context": FR_COPY.auth.passkey.insecureContext,
  failed: FR_COPY.auth.passkey.failed,
};

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
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
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
      fail(FR_COPY.auth.bootstrap.startFailed);
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

    setAttemptId(started.value.attemptId);
    setStage("password");
    setBusy(false);
  }, [api, fail, refreshStatus]);

  const submitPassword = useCallback(async () => {
    if (attemptId === null) {
      return;
    }
    setBusy(true);
    setMessage(null);

    const passwordResult = await api.setBootstrapPassword(attemptId, password);
    if (!passwordResult.ok) {
      fail(
        passwordResult.problem.code === "validation_failed"
          ? FR_COPY.auth.bootstrap.passwordTooShort
          : FR_COPY.auth.bootstrap.passwordFailed,
      );
      return;
    }

    const confirmed = await api.confirmBootstrap(attemptId);
    if (!confirmed.ok) {
      fail(FR_COPY.auth.bootstrap.completionFailed);
      await refreshStatus();
      return;
    }

    setStatus((previous) =>
      previous === null
        ? previous
        : { ...previous, state: "ready", ownerCount: 1, workspaceCount: 1 },
    );
    setAttemptId(null);
    setPassword("");
    setBusy(false);
    props.onReady?.();
  }, [api, attemptId, password, fail, refreshStatus, props.onReady]);

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
        <AsyncState compact kind="error" title={message} testId="bootstrap-message" />
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

      {stage === "password" ? (
        <section className="ui-auth-card" aria-labelledby="bootstrap-password-heading">
          <h2 id="bootstrap-password-heading">{FR_COPY.auth.bootstrap.passwordTitle}</h2>
          <p>{FR_COPY.auth.bootstrap.passwordDescription}</p>
          <label className="ui-field" htmlFor="bootstrap-password">
            <span>{FR_COPY.auth.bootstrap.passwordLabel}</span>
            <input
              id="bootstrap-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              data-testid="bootstrap-password"
            />
          </label>
          <Button
            type="button"
            variant="primary"
            busy={busy}
            disabled={password.length < 12}
            onClick={() => {
              void submitPassword();
            }}
            data-testid="bootstrap-password-submit"
          >
            {FR_COPY.auth.bootstrap.passwordAction}
          </Button>
        </section>
      ) : null}
    </main>
  );
}
