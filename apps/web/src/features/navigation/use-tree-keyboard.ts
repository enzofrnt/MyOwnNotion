/**
 * The keyboard the ARIA tree pattern promises (T049, US3, FR-017).
 *
 * Chosen over inventing a scheme so that the behaviour matches what a
 * screen-reader user already expects: arrows move, right expands or descends,
 * left collapses or ascends, Home and End jump, and typing a letter jumps to
 * the next item starting with it.
 *
 * **One tab stop for the whole tree.** Arrows move within it (roving tabindex).
 * A tree where every row is a tab stop is technically reachable and unusable at
 * a hundred pages — which is the distinction FR-017 and SC-003 are about, and
 * the reason this is a hook rather than a handler per row.
 */

import { useCallback } from "react";

export interface TreeKeyboardNode {
  readonly id: string;
  readonly name: string;
  /** Depth from the root, 1-based, as `aria-level` reports it. */
  readonly level: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly parentId: string | null;
}

export interface TreeKeyboardActions {
  readonly select: (id: string) => void;
  readonly setExpanded: (id: string, expanded: boolean) => void;
  readonly open: (id: string) => void;
  readonly rename: (id: string) => void;
  readonly remove: (id: string) => void;
}

export interface TreeKeyboardInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

export type TreeKeyboardIntent =
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "set-expanded"; readonly id: string; readonly expanded: boolean }
  | { readonly type: "open"; readonly id: string }
  | { readonly type: "rename"; readonly id: string }
  | { readonly type: "remove"; readonly id: string };

/** Matches the first item after `from` whose name starts with `prefix`. */
export function findByPrefix(
  nodes: readonly TreeKeyboardNode[],
  prefix: string,
  from: number,
): TreeKeyboardNode | undefined {
  const lower = prefix.toLowerCase();
  // Search after the current position first, then wrap. Typing "p" repeatedly
  // should walk through the pages rather than sticking on the first one.
  for (let step = 1; step <= nodes.length; step += 1) {
    const candidate = nodes[(from + step) % nodes.length];
    if (candidate?.name.toLowerCase().startsWith(lower)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolves the ARIA tree gesture without depending on React or the DOM.
 *
 * Keeping this decision pure makes the WebKit parent case testable separately
 * from the browser-specific focus hand-off. The caller performs the intent
 * synchronously before React updates the roving tabindex, which is what keeps
 * Safari from declining focus on the parent row.
 */
export function resolveTreeKeyboardIntent(
  nodes: readonly TreeKeyboardNode[],
  selectedId: string | null,
  input: TreeKeyboardInput,
): TreeKeyboardIntent | null {
  if (nodes.length === 0) return null;
  const index = nodes.findIndex((node) => node.id === selectedId);
  const current = index >= 0 ? nodes[index] : nodes[0];
  if (current === undefined) return null;

  const select = (target: TreeKeyboardNode | undefined): TreeKeyboardIntent | null =>
    target === undefined ? null : { type: "select", id: target.id };

  switch (input.key) {
    case "ArrowDown":
      return select(nodes[Math.min(Math.max(index, 0) + 1, nodes.length - 1)]);
    case "ArrowUp":
      return select(nodes[Math.max(Math.max(index, 0) - 1, 0)]);
    case "ArrowRight":
      if (current.hasChildren && !current.expanded) {
        return { type: "set-expanded", id: current.id, expanded: true };
      }
      return current.hasChildren ? select(nodes[index + 1]) : null;
    case "ArrowLeft":
      if (current.hasChildren && current.expanded) {
        return { type: "set-expanded", id: current.id, expanded: false };
      }
      return current.parentId === null
        ? null
        : select(nodes.find((node) => node.id === current.parentId));
    case "Home":
      return select(nodes[0]);
    case "End":
      return select(nodes[nodes.length - 1]);
    case "Enter":
    case " ":
      return { type: "open", id: current.id };
    case "F2":
      return { type: "rename", id: current.id };
    case "Delete":
      return { type: "remove", id: current.id };
    default:
      break;
  }

  if (input.key.length === 1 && !input.ctrlKey && !input.metaKey && !input.altKey) {
    return select(findByPrefix(nodes, input.key, Math.max(index, 0)));
  }
  return null;
}

export function useTreeKeyboard(
  nodes: readonly TreeKeyboardNode[],
  selectedId: string | null,
  actions: TreeKeyboardActions,
): (event: React.KeyboardEvent) => void {
  return useCallback(
    (event: React.KeyboardEvent) => {
      // Buttons inside a tree row own their own keyboard contract. Letting
      // Enter/Space bubble into the tree opens the page and unmounts a menu or
      // drag handle before it can act, which is especially visible in the
      // mobile drawer. Only a key whose focused target is the treeitem itself
      // belongs to roving-tree navigation.
      if (
        event.target instanceof Element &&
        event.target.closest<HTMLElement>('[role="treeitem"]') !== event.target
      ) {
        return;
      }
      const intent = resolveTreeKeyboardIntent(nodes, selectedId, event);
      if (intent === null) return;
      event.preventDefault();
      switch (intent.type) {
        case "select":
          actions.select(intent.id);
          return;
        case "set-expanded":
          actions.setExpanded(intent.id, intent.expanded);
          return;
        case "open":
          actions.open(intent.id);
          return;
        case "rename":
          actions.rename(intent.id);
          return;
        case "remove":
          actions.remove(intent.id);
          return;
      }
    },
    [nodes, selectedId, actions],
  );
}
