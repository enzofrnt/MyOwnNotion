import { plainContentToString } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";

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
        try {
          await navigator.clipboard.writeText(plainContentToString(block.content));
          setCopyState("copied");
        } catch {
          setCopyState("failed");
        }
      };

      return (
        <section className="editor-code-block" aria-label="Bloc de code">
          <header className="editor-code-toolbar" contentEditable={false}>
            <label>
              <span className="sr-only">Langage du code</span>
              <select
                aria-label="Langage du code"
                value={block.props.language}
                onChange={(event) =>
                  editor.updateBlock(block.id, { props: { language: event.currentTarget.value } })
                }
              >
                {CODE_LANGUAGES.map((language) => (
                  <option key={language || "none"} value={language}>
                    {language || "Texte brut"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void copy()}>
              Copier
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {copyState === "copied"
                ? "Code copié."
                : copyState === "failed"
                  ? "Impossible de copier le code."
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
