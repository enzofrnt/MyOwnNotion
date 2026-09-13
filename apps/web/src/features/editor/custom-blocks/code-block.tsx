import { plainContentToString } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon } from "../../../ui/icons.tsx";
import { Button } from "../../../ui/primitives/button.tsx";
import { CODE_LANGUAGES, codeHighlightLanguage } from "../code-highlighting.ts";

interface PlainTextClipboard {
  writeText(value: string): Promise<void>;
}

/** Copies exactly the plain source text; HTML is never interpreted or written. */
export async function copyCodeText(
  value: string,
  clipboard: PlainTextClipboard | null | undefined = typeof navigator === "undefined"
    ? null
    : navigator.clipboard,
): Promise<boolean> {
  if (clipboard == null) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function CodeBlockToolbar({
  language,
  source,
  editable,
  onLanguageChange,
}: {
  readonly language: string;
  readonly source: string;
  readonly editable: boolean;
  readonly onLanguageChange: (value: string) => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const copyPending = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A source change or unmount invalidates both stale clipboard promises and
  // feedback. None of these UI states becomes an editor transaction.
  useEffect(() => {
    void source;
    setCopyState("idle");
    copyPending.current = false;
    return () => {
      generation.current += 1;
      clearTimeout(timer.current);
    };
  }, [source]);

  const copy = async (): Promise<void> => {
    if (copyPending.current) return;
    copyPending.current = true;
    const currentGeneration = generation.current;
    clearTimeout(timer.current);
    setCopyState("copying");
    const copied = await copyCodeText(source);
    if (currentGeneration !== generation.current) return;
    copyPending.current = false;
    setCopyState(copied ? "copied" : "failed");
    timer.current = setTimeout(() => setCopyState("idle"), 3_000);
  };
  const knownLanguage = CODE_LANGUAGES.some((entry) => entry.value === language);
  const feedback =
    copyState === "copied"
      ? FR_COPY.editor.richBlocks.code.copied
      : copyState === "failed"
        ? FR_COPY.editor.richBlocks.code.copyFailed
        : "";

  return (
    <header className="editor-code-header" contentEditable={false}>
      <div className="editor-code-toolbar">
        <label className="editor-code-language">
          <AppIcon name="code" size="small" />
          <span className="sr-only">{FR_COPY.editor.richBlocks.code.language}</span>
          <select
            aria-label={FR_COPY.editor.richBlocks.code.language}
            value={language}
            disabled={!editable}
            onChange={(event) => onLanguageChange(event.currentTarget.value)}
          >
            <option value="">{FR_COPY.editor.richBlocks.code.plainText}</option>
            {language === "text" ? (
              <option value="text">{FR_COPY.editor.richBlocks.code.plainText}</option>
            ) : null}
            {language !== "" && language !== "text" && !knownLanguage ? (
              <option value={language}>{language}</option>
            ) : null}
            {CODE_LANGUAGES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          className="editor-code-copy"
          size="compact"
          variant="ghost"
          aria-label={FR_COPY.editor.richBlocks.code.copy}
          aria-busy={copyState === "copying" || undefined}
          onClick={() => void copy()}
        >
          <AppIcon name="copy" size="small" />
          {FR_COPY.editor.richBlocks.code.copy}
        </Button>
      </div>
      <span
        className="editor-code-feedback"
        data-state={copyState}
        role="status"
        aria-live="polite"
      >
        {feedback}
      </span>
    </header>
  );
}

export const codeBlockSpec = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: { language: { default: "" } },
    content: "plain",
  } as const,
  {
    meta: {
      code: true,
      isolating: true,
      hardBreakShortcut: "enter",
      highlight: (block) => codeHighlightLanguage(block.props.language),
    },
    render: ({ block, editor, contentRef }) => (
      <section className="editor-code-block" aria-label={FR_COPY.editor.richBlocks.code.label}>
        <CodeBlockToolbar
          language={block.props.language}
          source={plainContentToString(block.content)}
          editable={editor.isEditable}
          onLanguageChange={(language) => editor.updateBlock(block.id, { props: { language } })}
        />
        <pre className="ui-scrollbar">
          <code ref={contentRef} spellCheck={false} />
        </pre>
      </section>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <pre data-language={block.props.language || undefined}>
        <code ref={contentRef} />
      </pre>
    ),
  },
);
