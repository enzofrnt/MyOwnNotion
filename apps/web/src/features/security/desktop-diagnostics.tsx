import { useEffect, useState } from "react";
import { FR_COPY } from "../../ui/copy/fr.ts";

export function DesktopDiagnostics() {
  const [lines, setLines] = useState<readonly string[]>([]);

  useEffect(() => {
    const desktop = window.myownnotionDesktop;
    if (desktop === undefined) {
      return;
    }
    let mounted = true;
    const showState = (state: string) => {
      if (!mounted) return;
      setLines([
        `${FR_COPY.desktop.diagnostics.platform}: ${desktop.platform}`,
        `${FR_COPY.desktop.diagnostics.version}: ${desktop.appVersion}`,
        `${FR_COPY.desktop.diagnostics.key}: ${state}`,
      ]);
    };
    void desktop.getKeyState().then(
      (result) => showState(result.state),
      () => showState("unavailable"),
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (lines.length === 0) {
    return null;
  }

  return (
    <section aria-label={FR_COPY.desktop.diagnostics.label} data-testid="desktop-diagnostics">
      <h2>{FR_COPY.desktop.diagnostics.label}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
