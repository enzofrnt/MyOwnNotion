import type {
  Block,
  BlockNoteEditor,
  BlockSpec,
  BlocksChanged,
  PartialBlock,
} from "@blocknote/core";
import {
  BlockNoteSchema,
  createHeadingBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { calloutBlockSpec } from "./custom-blocks/callout.tsx";
import { codeBlockSpec } from "./custom-blocks/code-block.tsx";
import { embedBlockSpec } from "./custom-blocks/embed.tsx";
import { fileEmbedBlockSpec } from "./custom-blocks/file-embed.tsx";
import { imageBlockSpec } from "./custom-blocks/image.tsx";
import { tableBlockSpec, tableCellBlockSpec, tableRowBlockSpec } from "./custom-blocks/table.tsx";
import { toggleBlockSpec } from "./custom-blocks/toggle.tsx";
import { unknownBlockSpec } from "./custom-blocks/unknown-block.tsx";
import { pageLinkInlineContentSpec } from "./page-link-inline-content.ts";

type NonToggleHeadingProps = Omit<
  ReturnType<typeof createHeadingBlockSpec>["config"]["propSchema"],
  "isToggleable"
>;

// BlockNote 0.54 keeps `isToggleable` optional in the factory return type even
// when toggles are disabled. Removing that impossible key makes the concrete
// community schema compatible with `exactOptionalPropertyTypes`.
const headingBlockSpec = createHeadingBlockSpec({
  levels: [1, 2, 3],
  allowToggleHeadings: false,
}) as unknown as BlockSpec<"heading", NonToggleHeadingProps, "inline">;

/**
 * Community-only V1 schema. Custom rich blocks keep MyOwnNotion identities
 * and file/embed policies instead of adopting BlockNote's URL-owned defaults.
 */
export const blockNoteSchema = BlockNoteSchema.create({
  // Keeping unsupported defaults out of the schema prevents keyboard, paste,
  // and programmatic paths from creating a block the canonical v3 projection
  // cannot represent yet. It also avoids inspecting an id-less split-block
  // transaction in `onBeforeChange`; BlockNote assigns that id in its own
  // appended UniqueID transaction.
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: headingBlockSpec,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: codeBlockSpec(),
    divider: defaultBlockSpecs.divider,
    toggleListItem: toggleBlockSpec,
    callout: calloutBlockSpec(),
    table: tableBlockSpec(),
    tableRow: tableRowBlockSpec(),
    tableCell: tableCellBlockSpec(),
    image: imageBlockSpec(),
    fileEmbed: fileEmbedBlockSpec(),
    embed: embedBlockSpec(),
    unknown: unknownBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageLink: pageLinkInlineContentSpec,
  },
});

interface OpaqueEditorBlock {
  readonly id: string;
  readonly type: "unknown";
  readonly props: {
    readonly declaredType: string;
    readonly rawJson: string;
    readonly syntheticId: boolean;
  };
  readonly content: undefined;
  readonly children: readonly EditorBlock[];
}

interface OpaqueEditorPartialBlock {
  readonly id?: string;
  readonly type: "unknown";
  readonly props?: Partial<OpaqueEditorBlock["props"]>;
  readonly children?: readonly EditorPartialBlock[];
}

interface RichEditorBlock {
  readonly id: string;
  readonly type: "callout" | "table" | "tableRow" | "tableCell" | "image" | "fileEmbed" | "embed";
  readonly props: Record<string, boolean | number | string | undefined>;
  readonly content: unknown;
  readonly children: readonly EditorBlock[];
}

interface RichEditorPartialBlock {
  readonly id?: string;
  readonly type: RichEditorBlock["type"];
  readonly props?: Record<string, boolean | number | string | undefined>;
  readonly content?: unknown;
  readonly children?: readonly EditorPartialBlock[];
}

export type EditorBlock = Block | OpaqueEditorBlock | RichEditorBlock;
export type EditorPartialBlock = PartialBlock | OpaqueEditorPartialBlock | RichEditorPartialBlock;
export type EditorInstance = BlockNoteEditor;

type EditorChangeSource = BlocksChanged[number]["source"];
export type EditorBlocksChanged = Array<
  | {
      readonly type: "insert" | "delete";
      readonly block: EditorBlock;
      readonly prevBlock: undefined;
      readonly source: EditorChangeSource;
    }
  | {
      readonly type: "update";
      readonly block: EditorBlock;
      readonly prevBlock: EditorBlock;
      readonly source: EditorChangeSource;
    }
  | {
      readonly type: "move";
      readonly block: EditorBlock;
      readonly prevBlock: EditorBlock;
      readonly prevParent?: EditorBlock;
      readonly currentParent?: EditorBlock;
      readonly source: EditorChangeSource;
    }
>;
