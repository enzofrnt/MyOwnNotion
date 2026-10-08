import { renderToString } from "katex";
import { useMemo } from "react";
import { FR_COPY } from "../../ui/copy/fr.ts";

export function renderMath(
  expression: string,
  displayMode: boolean,
): { html: string | null; error: boolean } {
  if (expression.length > 65_536) return { html: null, error: true };
  try {
    return {
      html: renderToString(expression, {
        displayMode,
        output: "htmlAndMathml",
        trust: false,
        throwOnError: true,
        strict: "ignore",
        maxExpand: 1000,
        maxSize: 20,
        macros: {},
      }),
      error: false,
    };
  } catch {
    return { html: null, error: true };
  }
}
export function MathPreview({
  expression,
  displayMode = false,
}: {
  readonly expression: string;
  readonly displayMode?: boolean;
}) {
  const result = useMemo(() => renderMath(expression, displayMode), [expression, displayMode]);
  if (expression.trim() === "")
    return <span className="editor-math-empty">{FR_COPY.editor.math.empty}</span>;
  if (result.html === null)
    return (
      <span className="editor-math-error">
        <code>{expression}</code>
        <span>{FR_COPY.editor.math.invalid}</span>
      </span>
    );
  // KaTeX escapes input and runs with trust=false. Only its generated markup enters this node.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: locally generated, untrusted commands disabled.
  return <span className="editor-math-render" dangerouslySetInnerHTML={{ __html: result.html }} />;
}
