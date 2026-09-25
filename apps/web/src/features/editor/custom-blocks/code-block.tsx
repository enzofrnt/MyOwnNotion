import { plainContentToString } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon } from "../../../ui/icons.tsx";
import { Button } from "../../../ui/primitives/button.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../../ui/primitives/menu.tsx";
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

function languageLabel(language: string): string {
  if (language === "" || language === "text") {
    return FR_COPY.editor.richBlocks.code.plainText;
  }
  return CODE_LANGUAGES.find((entry) => entry.value === language)?.label ?? language;
}

function LanguageOption({
  selected,
  children,
  onSelect,
}: {
  readonly selected: boolean;
  readonly children: string;
  readonly onSelect: () => void;
}) {
  return (
    <MenuItem
      className="editor-code-language-option"
      data-selected={selected || undefined}
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="editor-code-language-option__check" aria-hidden="true">
        {selected ? <AppIcon name="check" size="small" /> : null}
      </span>
      <span className="editor-code-language-option__label">{children}</span>
    </MenuItem>
  );
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
  const plainSelected = language === "" || language === "text";
  const feedback =
    copyState === "copied"
      ? FR_COPY.editor.richBlocks.code.copied
      : copyState === "failed"
        ? FR_COPY.editor.richBlocks.code.copyFailed
        : "";

  return (
    <header className="editor-code-header" contentEditable={false}>
      <div className="editor-code-toolbar">
        <MenuRoot placement="bottom-start">
          <MenuTrigger
            className="editor-code-language"
            disabled={!editable}
            aria-label={FR_COPY.editor.richBlocks.code.language}
            data-testid="code-language-trigger"
            title={languageLabel(language)}
          >
            <AppIcon name="code" size="small" />
            <span className="editor-code-language__value">{languageLabel(language)}</span>
            {editable ? <AppIcon name="chevronDown" size="small" /> : null}
          </MenuTrigger>
          <MenuContent
            className="editor-code-language-menu"
            aria-label={FR_COPY.editor.richBlocks.code.language}
            data-testid="code-language-menu"
          >
            <LanguageOption selected={plainSelected} onSelect={() => onLanguageChange("")}>
              {FR_COPY.editor.richBlocks.code.plainText}
            </LanguageOption>
            {language !== "" && language !== "text" && !knownLanguage ? (
              <LanguageOption selected onSelect={() => onLanguageChange(language)}>
                {language}
              </LanguageOption>
            ) : null}
            {CODE_LANGUAGES.map((entry) => (
              <LanguageOption
                key={entry.value}
                selected={language === entry.value}
                onSelect={() => onLanguageChange(entry.value)}
              >
                {entry.label}
              </LanguageOption>
            ))}
          </MenuContent>
        </MenuRoot>
        <Button
          className="editor-code-copy"
          size="compact"
          variant="ghost"
          aria-label={FR_COPY.editor.richBlocks.code.copy}
          aria-busy={copyState === "copying" || undefined}
          data-testid="code-copy"
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
          onLanguageChange={(next) => editor.updateBlock(block.id, { props: { language: next } })}
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
