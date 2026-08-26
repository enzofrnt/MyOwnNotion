import { plainContentToString } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";

const CODE_LANGUAGES = [
  "",
  "text",
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "sql",
  "tsx",
  "typescript",
] as const;

interface PlainTextClipboard {
  writeText(value: string): Promise<void>;
}

/** Copies exactly the plain source text; HTML is never interpreted or written. */
export async function copyCodeText(
  value: string,
  clipboard: PlainTextClipboard | null = typeof navigator === "undefined"
    ? null
    : navigator.clipboard,
): Promise<boolean> {
  if (clipboard === null) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export const codeBlockSpec = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: { language: { default: "" } },
    content: "plain",
  } as const,
  {
    meta: { code: true, isolating: true, hardBreakShortcut: "enter" },
    render: ({ block, editor, contentRef }) => {
      const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
      const copy = async (): Promise<void> => {
        setCopyState(
          (await copyCodeText(plainContentToString(block.content))) ? "copied" : "failed",
        );
      };

      return (
        <section className="editor-code-block" aria-label={FR_COPY.editor.richBlocks.code.label}>
          <header className="editor-code-toolbar" contentEditable={false}>
            <label>
              <span className="sr-only">{FR_COPY.editor.richBlocks.code.language}</span>
              <select
                aria-label={FR_COPY.editor.richBlocks.code.language}
                value={block.props.language}
                disabled={!editor.isEditable}
                onChange={(event) =>
                  editor.updateBlock(block.id, { props: { language: event.currentTarget.value } })
                }
              >
                {CODE_LANGUAGES.map((language) => (
                  <option key={language || "none"} value={language}>
                    {language || FR_COPY.editor.richBlocks.code.plainText}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void copy()}>
              {FR_COPY.editor.richBlocks.code.copy}
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copyState === "copied"
                ? FR_COPY.editor.richBlocks.code.copied
                : copyState === "failed"
                  ? FR_COPY.editor.richBlocks.code.copyFailed
                  : ""}
            </span>
          </header>
          <pre>
            <code ref={contentRef} spellCheck={false} />
          </pre>
        </section>
      );
    },
    toExternalHTML: ({ block, contentRef }) => (
      <pre data-language={block.props.language || undefined}>
        <code ref={contentRef} />
      </pre>
    ),
  },
);
