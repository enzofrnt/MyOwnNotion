import type { DatabaseViewType } from "@myownnotion/domain";
import type { AppIconName } from "../../ui/icons.tsx";

export const VIEW_TYPE_LABEL: Readonly<Record<DatabaseViewType, string>> = {
  table: "Tableau",
  board: "Kanban",
  gallery: "Galerie",
  list: "Liste",
  calendar: "Calendrier",
};

export const VIEW_TYPE_ICON: Readonly<Record<DatabaseViewType, AppIconName>> = {
  table: "viewTable",
  board: "kanban",
  gallery: "gallery",
  list: "list",
  calendar: "calendar",
};

const AUTOMATIC_VIEW_NAME = /^(Tableau|Kanban|Galerie|Liste|Calendrier)(?: \d+)*$/;

const STACKED_VIEW_NAME = /^(Tableau|Kanban|Galerie|Liste|Calendrier)(?: \d+){2,}$/;

export function isAutomaticViewName(name: string): boolean {
  return AUTOMATIC_VIEW_NAME.test(name);
}

export function isStackedViewName(name: string): boolean {
  return STACKED_VIEW_NAME.test(name);
}

/**
 * The name shown as a hint, and restored when a chosen name is cleared.
 * An untouched automatic name stays itself. A chosen name falls back to the
 * next free name of its format.
 */
export function fallbackViewName(
  type: DatabaseViewType,
  name: string,
  otherNames: readonly string[],
): string {
  if (isAutomaticViewName(name)) return name;
  return nextAutomaticViewName(type, otherNames);
}

/** A chosen name becomes "Nom (1)". The next duplicate of that name is "Nom (2)". */
export function duplicateChosenViewName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ \(\d+\)$/, "");
  const used = new Set(taken);
  let index = 1;
  let candidate = `${base} (${index})`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base} (${index})`;
  }
  return candidate;
}

/** First view of a format is "Tableau". The next free one is "Tableau 2", then "Tableau 3". */
export function nextAutomaticViewName(
  type: DatabaseViewType,
  taken: ReadonlySet<string> | readonly string[],
): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const label = VIEW_TYPE_LABEL[type];
  if (!used.has(label)) return label;
  let index = 2;
  while (used.has(`${label} ${index}`)) index += 1;
  return `${label} ${index}`;
}

interface NamedView {
  readonly id: string;
  readonly name: string;
  readonly type: DatabaseViewType;
  readonly state: string;
  readonly positionKey: string;
}

/** Replace "Tableau 2 3" with the next free name of that format, in tab order. */
export function repairAutomaticViewNames<T extends NamedView>(
  views: readonly T[],
): readonly T[] | null {
  const active = views
    .filter((view) => view.state === "active")
    .sort((left, right) => left.positionKey.localeCompare(right.positionKey));
  if (!active.some((view) => isStackedViewName(view.name))) return null;
  const used = new Set(
    active.filter((view) => !isAutomaticViewName(view.name)).map((view) => view.name),
  );
  const renamed = new Map<string, string>();
  for (const view of active) {
    if (!isAutomaticViewName(view.name)) continue;
    const name = nextAutomaticViewName(view.type, used);
    used.add(name);
    if (name !== view.name) renamed.set(view.id, name);
  }
  if (renamed.size === 0) return null;
  return views.map((view) => {
    const name = renamed.get(view.id);
    return name === undefined ? view : { ...view, name };
  });
}
