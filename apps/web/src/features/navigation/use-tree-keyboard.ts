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

export function useTreeKeyboard(
  nodes: readonly TreeKeyboardNode[],
  selectedId: string | null,
  actions: TreeKeyboardActions,
): (event: React.KeyboardEvent) => void {
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (nodes.length === 0) {
        return;
      }
      const index = nodes.findIndex((node) => node.id === selectedId);
      const current = index >= 0 ? nodes[index] : nodes[0];
      if (current === undefined) {
        return;
      }

      const move = (target: TreeKeyboardNode | undefined): void => {
        if (target !== undefined) {
          event.preventDefault();
          actions.select(target.id);
        }
      };

      switch (event.key) {
        case "ArrowDown":
          move(nodes[Math.min(Math.max(index, 0) + 1, nodes.length - 1)]);
          return;

        case "ArrowUp":
          move(nodes[Math.max(Math.max(index, 0) - 1, 0)]);
          return;

        case "ArrowRight":
          // Expand, or descend into an already-open branch. A leaf does
          // nothing rather than swallowing the key.
          if (current.hasChildren && !current.expanded) {
            event.preventDefault();
            actions.setExpanded(current.id, true);
          } else if (current.hasChildren) {
            move(nodes[index + 1]);
          }
          return;

        case "ArrowLeft":
          // Collapse, or rise to the parent. At the root of a closed branch
          // there is nowhere to go, and the key is left alone.
          if (current.hasChildren && current.expanded) {
            event.preventDefault();
            actions.setExpanded(current.id, false);
          } else if (current.parentId !== null) {
            move(nodes.find((node) => node.id === current.parentId));
          }
          return;

        case "Home":
          move(nodes[0]);
          return;

        case "End":
          move(nodes[nodes.length - 1]);
          return;

        case "Enter":
        case " ":
          event.preventDefault();
          actions.open(current.id);
          return;

        case "F2":
          event.preventDefault();
          actions.rename(current.id);
          return;

        case "Delete":
          event.preventDefault();
          actions.remove(current.id);
          return;

        default:
          break;
      }

      // Type-ahead. Single printable characters only: modifiers belong to the
      // browser and the application, and swallowing them here would break
      // everything from Ctrl+F to the browser's own shortcuts.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const match = findByPrefix(nodes, event.key, Math.max(index, 0));
        move(match);
      }
    },
    [nodes, selectedId, actions],
  );
}
