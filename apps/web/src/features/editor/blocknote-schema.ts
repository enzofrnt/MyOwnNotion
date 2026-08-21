import type {
  Block,
  BlockNoteEditor,
  BlockSpec,
  BlocksChanged,
  PartialBlock,
} from "@blocknote/core";
import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { unknownBlockSpec } from "./custom-blocks/unknown-block.tsx";

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
 * The Community-only editor schema for the first BlockNote slice.
 *
 * Deliberately omit media, tables and toggle blocks here: those become safe to
 * create in US3, once their durable file/table contracts are wired. Existing
 * unsupported content is represented by the opaque `unknown` view instead of
 * being discarded or exposed through a half-working default BlockNote block.
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
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    unknown: unknownBlockSpec(),
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

export type EditorBlock = Block | OpaqueEditorBlock;
export type EditorPartialBlock = PartialBlock | OpaqueEditorPartialBlock;
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
