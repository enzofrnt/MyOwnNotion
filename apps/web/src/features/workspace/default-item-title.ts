/** Stored name and empty-title placeholder for a newly created item. */
export const DEFAULT_ITEM_TITLE = {
  page: "Nouvelle page",
  folder: "Nouveau dossier",
  database: "Nouvelle base de données",
} as const;

export function defaultItemTitle(
  kind: "page" | "folder" | "database" | "database_view" = "page",
): string {
  if (kind === "folder") return DEFAULT_ITEM_TITLE.folder;
  if (kind === "database") return DEFAULT_ITEM_TITLE.database;
  return DEFAULT_ITEM_TITLE.page;
}
