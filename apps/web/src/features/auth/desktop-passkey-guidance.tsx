import { useEffect, useState } from "react";
import { Button, FR_COPY } from "../../ui/index.ts";
import {
  openCurrentPageInSystemBrowser,
  platformAuthenticatorAvailable,
} from "./passkey-client.ts";

export function useDesktopPlatformPasskey(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const desktop = window.myownnotionDesktop;
    if (desktop === undefined || desktop.platform !== "darwin") {
      setAvailable(true);
      return;
    }
    void platformAuthenticatorAvailable().then(setAvailable);
  }, []);

  return available;
}

export function DesktopPasskeyGuidance(props: { readonly testId?: string }) {
  const [opening, setOpening] = useState(false);

  return (
    <section
      className="ui-auth-card"
      aria-labelledby="desktop-passkey-guidance-heading"
      data-testid={props.testId ?? "desktop-passkey-guidance"}
    >
      <h2 id="desktop-passkey-guidance-heading">{FR_COPY.auth.passkey.desktopUnavailableTitle}</h2>
      <p>{FR_COPY.auth.passkey.desktopUnavailableDescription}</p>
      <Button
        type="button"
        variant="primary"
        busy={opening}
        onClick={() => {
          setOpening(true);
          void openCurrentPageInSystemBrowser().finally(() => {
            setOpening(false);
          });
        }}
        data-testid="open-passkey-in-safari"
      >
        {FR_COPY.auth.passkey.openInSafari}
      </Button>
    </section>
  );
}
