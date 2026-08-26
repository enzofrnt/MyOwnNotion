import { createReactBlockSpec } from "@blocknote/react";
import { COLOR_TOKENS, type ColorToken } from "@myownnotion/domain";
import { FR_COPY } from "../../../ui/copy/fr.ts";

const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function firstGrapheme(value: string): string {
  const candidate = value.trim();
  if (candidate === "") return "";
  const segmenter = new Intl.Segmenter("fr", { granularity: "grapheme" });
  const grapheme = segmenter.segment(candidate)[Symbol.iterator]().next().value?.segment ?? "";
  return EMOJI_GRAPHEME.test(grapheme) ? grapheme : "";
}

function toneLabel(tone: ColorToken): string {
  return FR_COPY.editor.richBlocks.callout.tones[tone];
}

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      icon: { default: "" },
      tone: { default: "default", values: COLOR_TOKENS },
    },
    content: "inline",
  } as const,
  {
    meta: { isolating: false },
    render: ({ block, editor, contentRef }) => (
      <aside
        className="editor-callout"
        data-tone={block.props.tone}
        aria-label={FR_COPY.editor.richBlocks.callout.label}
      >
        <div className="editor-callout-controls" contentEditable={false}>
          <input
            className="editor-callout-icon"
            aria-label={FR_COPY.editor.richBlocks.callout.icon}
            value={block.props.icon}
            placeholder="💡"
            disabled={!editor.isEditable}
            onChange={(event) =>
              editor.updateBlock(block.id, {
                props: { icon: firstGrapheme(event.currentTarget.value) },
              })
            }
          />
          <label>
            <span className="sr-only">{FR_COPY.editor.richBlocks.callout.tone}</span>
            <select
              aria-label={FR_COPY.editor.richBlocks.callout.tone}
              value={block.props.tone}
              disabled={!editor.isEditable}
              onChange={(event) =>
                editor.updateBlock(block.id, {
                  props: { tone: event.currentTarget.value as ColorToken },
                })
              }
            >
              {COLOR_TOKENS.map((tone) => (
                <option key={tone} value={tone}>
                  {toneLabel(tone)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="editor-callout-content" ref={contentRef} />
      </aside>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <aside className="editor-callout" data-tone={block.props.tone}>
        <span aria-hidden="true">{block.props.icon || "💡"}</span>
        <div ref={contentRef} />
      </aside>
    ),
  },
);
