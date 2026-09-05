import { useCallback, useState } from "react";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState, Button, Field } from "../../ui/primitives/index.ts";

export interface DesktopConnectionPageProps {
  readonly onConnected: () => void;
}

/** Passkeys and `__Host-` session cookies require HTTPS in Electron; dev trusts Caddy locally. */
export const DEFAULT_DESKTOP_SERVER_URL = "https://localhost:8443";

export function DesktopConnectionPage({ onConnected }: DesktopConnectionPageProps) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_DESKTOP_SERVER_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const desktop = window.myownnotionDesktop;
      if (desktop === undefined) {
        setError(FR_COPY.desktop.connection.missingBridge);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await desktop.setActiveProfile({ serverUrl });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onConnected();
      } catch {
        setError(FR_COPY.desktop.connection.failed);
      } finally {
        setBusy(false);
      }
    },
    [onConnected, serverUrl],
  );

  return (
    <main
      className="desktop-connection-page ui-auth-surface"
      data-testid="desktop-connection-page"
      aria-labelledby="desktop-connection-heading"
    >
      <h1 id="desktop-connection-heading">{FR_COPY.desktop.connection.title}</h1>
      <p>{FR_COPY.desktop.connection.description}</p>
      <form className="ui-auth-card" onSubmit={(event) => void submit(event)}>
        <Field
          label={FR_COPY.desktop.connection.serverUrl}
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          required
          disabled={busy}
        />
        {error === null ? null : (
          <AsyncState compact kind="error" testId="desktop-connection-error" title={error} />
        )}
        <Button type="submit" variant="primary" busy={busy}>
          {FR_COPY.desktop.connection.submit}
        </Button>
      </form>
    </main>
  );
}
