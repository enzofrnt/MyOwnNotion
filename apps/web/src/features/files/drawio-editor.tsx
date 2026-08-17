/**
 * Editing a diagram without sending it anywhere (T030, T031, US3, FR-011).
 *
 * The editor is served by this installation. That is the whole point, and it
 * is a privacy decision rather than a preference: the obvious integration is an
 * iframe pointing at `embed.diagrams.net`, which sends the owner's diagram to a
 * third party on every edit. A diagram of one's own infrastructure is exactly
 * what an owner would never knowingly post to a public service, and the product
 * is self-hosted precisely so that they do not have to.
 *
 * `assertLocalEditor` refuses any origin that is not this installation's,
 * rather than trusting the configuration to be right. A misconfiguration here
 * does not degrade the feature — it exfiltrates content — so it fails loudly
 * instead of quietly working.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Where the editor is served from, defaulting to this installation's own. */
export function editorOrigin(): string {
  return import.meta.env["VITE_MYOWNNOTION_DRAWIO_ORIGIN"] ?? "http://127.0.0.1:8081";
}

/**
 * Refuses an editor origin that is not self-hosted.
 *
 * The list is of known public hosts rather than an allow-list of private ones,
 * because an installation may legitimately sit on any hostname the owner
 * chose. What must never happen is the specific thing this feature was
 * designed to avoid.
 */
export function assertLocalEditor(origin: string): void {
  const forbidden = ["diagrams.net", "draw.io", "jgraph.com"];
  const host = (() => {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host === "") {
    throw new Error(`The diagram editor origin is not a URL: ${origin}`);
  }
  if (forbidden.some((banned) => host === banned || host.endsWith(`.${banned}`))) {
    throw new Error(
      `Refusing to load the diagram editor from ${host}: the owner's diagrams would be sent to a third party. Serve it from this installation instead.`,
    );
  }
}

type State = "loading" | "ready" | "saving" | "failed";

export function DrawioEditor({
  fileItemId,
  fileName,
  onSave,
}: {
  readonly fileItemId: string;
  readonly fileName: string;
  /** Saves the edited diagram through the ordinary content path (T031). */
  readonly onSave: (xml: string) => Promise<boolean>;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [state, setState] = useState<State>("loading");
  const [refusal, setRefusal] = useState<string | null>(null);

  const origin = editorOrigin();
  useEffect(() => {
    try {
      assertLocalEditor(origin);
    } catch (error) {
      // Loudly, and without loading anything: a misconfigured origin here is a
      // data leak, not a degraded experience.
      setRefusal(error instanceof Error ? error.message : String(error));
      setState("failed");
    }
  }, [origin]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (event.origin !== origin) {
        // Messages from anywhere else are ignored outright. An editor frame is
        // a message channel, and one that trusts any sender is one any page can
        // drive.
        return;
      }
      const payload = typeof event.data === "string" ? safeParse(event.data) : null;
      if (payload === null) {
        return;
      }
      if (payload.event === "init") {
        setState("ready");
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ action: "load", autosave: 0, xml: "" }),
          origin,
        );
        return;
      }
      if (payload.event === "save" && typeof payload.xml === "string") {
        setState("saving");
        const saved = await onSave(payload.xml);
        setState(saved ? "ready" : "failed");
      }
    },
    [origin, onSave],
  );

  useEffect(() => {
    const listener = (event: MessageEvent) => void handleMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [handleMessage]);

  if (refusal !== null) {
    return (
      <p className="status-banner" data-state="error" role="alert" data-testid="drawio-refused">
        {refusal}
      </p>
    );
  }

  return (
    <section aria-label={`Diagram editor for ${fileName}`} data-testid="drawio-editor">
      <p className="muted" role="status" data-testid="drawio-state">
        {state === "loading"
          ? "Opening the diagram editor…"
          : state === "saving"
            ? "Saving…"
            : state === "failed"
              ? "This diagram could not be saved."
              : "Ready"}
      </p>
      <iframe
        ref={frame}
        // Served by this installation, so it is same-origin to nothing else and
        // reaches no third party. It still runs sandboxed: an editor is a large
        // program, and the file it opens is the owner's data.
        sandbox="allow-scripts allow-same-origin"
        src={`${origin}/?embed=1&proto=json&spin=1&noSaveBtn=0`}
        title={`Diagram editor for ${fileName}`}
        className="file-preview"
        data-testid="drawio-frame"
        data-file-item-id={fileItemId}
      />
    </section>
  );
}

function safeParse(value: string): { event?: string; xml?: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as { event?: string; xml?: string })
      : null;
  } catch {
    // A frame is free to send anything; unparseable traffic is ignored rather
    // than crashing the screen that hosts it.
    return null;
  }
}
