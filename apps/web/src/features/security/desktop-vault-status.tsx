import { useEffect, useState } from "react";
import type { KeyAvailability } from "../../types/desktop-runtime.d.ts";
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState } from "../../ui/primitives/async-state.tsx";

export function DesktopVaultStatus() {
  const [state, setState] = useState<KeyAvailability | "checking">("checking");

  useEffect(() => {
    const desktop = window.myownnotionDesktop;
    if (desktop === undefined) {
      return;
    }
    let mounted = true;
    void desktop.getKeyState().then(
      (result) => {
        if (mounted) setState(result.state);
      },
      () => {
        if (mounted) setState("unavailable");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (state === "checking" || state === "available") {
    return null;
  }

  const copy = FR_COPY.desktop.vault[state === "missing" ? "missing" : state];
  return (
    <AsyncState
      compact
      kind="error"
      testId="desktop-vault-status"
      title={copy.title}
      description={copy.description}
    />
  );
}
