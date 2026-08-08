import { generateUuidV7, isUuid, type Uuid } from "@myownnotion/domain";
import { type Editor, Mark, mergeAttributes, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import {
  WikiLinkMenu,
  type WikiLinkMenuHandle,
  type WikiLinkMenuProps,
} from "./wiki-link-menu.tsx";

export interface WikiLinkCandidate {
  readonly id: Uuid;
  readonly name: string;
}

export interface WikiLinkOptions {
  readonly sourceItemId: Uuid;
  readonly getCandidates: () => readonly WikiLinkCandidate[];
  readonly onNavigate: (targetItemId: Uuid) => void;
}

export const WikiLinkPluginKey = new PluginKey("wiki-link-suggestion");

export function filterWikiLinkCandidates(
  candidates: readonly WikiLinkCandidate[],
  query: string,
  sourceItemId: Uuid,
): WikiLinkCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  return candidates
    .filter(
      (candidate) =>
        candidate.id !== sourceItemId &&
        (normalized.length === 0 || candidate.name.toLocaleLowerCase().includes(normalized)),
    )
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .slice(0, 50);
}

export function insertWikiLink(
  editor: Editor,
  range: Range,
  candidate: WikiLinkCandidate,
  occurrenceId: Uuid = generateUuidV7(),
): boolean {
  return editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([
      {
        type: "text",
        text: candidate.name,
        marks: [{ type: "wikiLink", attrs: { targetItemId: candidate.id, occurrenceId } }],
      },
      { type: "text", text: " " },
    ])
    .run();
}

type MenuSuggestionProps = Pick<
  SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>,
  "items" | "command"
>;

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",
  inclusive: false,
  exitable: true,

  addOptions() {
    return {
      sourceItemId: "00000000-0000-0000-0000-000000000000" as Uuid,
      getCandidates: () => [],
      onNavigate: () => undefined,
    };
  },

  addAttributes() {
    return {
      targetItemId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-target-item-id"),
        renderHTML: (attributes) => ({ "data-target-item-id": attributes["targetItemId"] }),
      },
      occurrenceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-occurrence-id"),
        renderHTML: (attributes) => ({ "data-occurrence-id": attributes["occurrenceId"] }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "true",
        href: `#page-${String(HTMLAttributes["data-target-item-id"] ?? "")}`,
        class: "wiki-link",
        title: "Open linked page",
        tabindex: "0",
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isActive(this.name)) {
          return false;
        }
        const targetItemId = this.editor.getAttributes(this.name)["targetItemId"];
        if (!isUuid(targetItemId)) {
          return false;
        }
        this.options.onNavigate(targetItemId);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<WikiLinkCandidate, WikiLinkCandidate>({
        editor: this.editor,
        pluginKey: WikiLinkPluginKey,
        char: "[[",
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) =>
          filterWikiLinkCandidates(options.getCandidates(), query, options.sourceItemId),
        command: ({ editor, range, props }) => {
          insertWikiLink(editor, range, props);
        },
        allow: ({ state }) => state.selection.$from.parent.isTextblock,
        render: () => {
          let component: ReactRenderer<WikiLinkMenuHandle, WikiLinkMenuProps> | null = null;
          let unmount: (() => void) | null = null;
          const update = (props: MenuSuggestionProps) =>
            component?.updateProps({ items: props.items, command: props.command });
          return {
            onStart: (props) => {
              component = new ReactRenderer(WikiLinkMenu, {
                editor: props.editor,
                props: { items: props.items, command: props.command },
                className: "wiki-link-portal",
              });
              unmount = props.mount(component.element);
            },
            onUpdate: update,
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (event.key === "Escape") {
                exitSuggestion(view, WikiLinkPluginKey);
                return true;
              }
              return component?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              unmount?.();
              unmount = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
      new Plugin({
        props: {
          handleClick: (_view, _position, event) => {
            const element =
              event.target instanceof Element ? event.target.closest("a[data-wiki-link]") : null;
            const targetItemId = element?.getAttribute("data-target-item-id");
            if (!isUuid(targetItemId)) {
              return false;
            }
            event.preventDefault();
            options.onNavigate(targetItemId);
            return true;
          },
          handleDOMEvents: {
            keydown: (_view, event) => {
              if (event.key !== "Enter") {
                return false;
              }
              const element =
                event.target instanceof Element ? event.target.closest("a[data-wiki-link]") : null;
              const targetItemId = element?.getAttribute("data-target-item-id");
              if (!isUuid(targetItemId)) {
                return false;
              }
              event.preventDefault();
              options.onNavigate(targetItemId);
              return true;
            },
          },
        },
      }),
    ];
  },
});
