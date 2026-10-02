/** Decisions for a source attached to its origin database page. */

export const MISSING_DATA_SOURCE_MESSAGE =
  "Aucun résultat : la source de données demandée n'existe plus.";

export function linkedDatabasePageName(sourceName: string): string {
  const name = sourceName.trim();
  return `Vue de ${name.length > 0 ? name : "source"}`;
}

export type DatabasePageTitleMode = "source" | "page-and-source";

/** One displayed source uses that source's title. Several use the page name, then the current source. */
export function databasePageTitleMode(distinctSourceCount: number): DatabasePageTitleMode {
  return distinctSourceCount > 1 ? "page-and-source" : "source";
}

export function databasePageShowsLinkArrow(ownedSourceCount: number): boolean {
  return ownedSourceCount < 1;
}

export type ViewDeletionOffer = "view-only" | "view-or-source";

/**
 * The origin page asks before removing the last view of a source it owns.
 * A view of a source born on another page never offers to delete that source.
 */
export function viewDeletionOffer(input: {
  readonly currentPageId: string;
  readonly sourceOriginPageId: string;
  readonly activeViewsOfSourceOnCurrentPage: number;
}): ViewDeletionOffer {
  if (input.currentPageId !== input.sourceOriginPageId) return "view-only";
  if (input.activeViewsOfSourceOnCurrentPage <= 1) return "view-or-source";
  return "view-only";
}

/** Confirmation before deleting a database page that owns sources. Null when it owns none. */
export function databasePageTrashWarning(sourceCount: number): string | null {
  if (!Number.isInteger(sourceCount) || sourceCount < 1) return null;
  const noun = sourceCount === 1 ? "source de données" : "sources de données";
  const these = sourceCount === 1 ? "cette source" : "ces sources";
  return `Cette page contient ${sourceCount} ${noun}. Sa suppression entraînera également la suppression de ${these} et pourra affecter les vues qui les utilisent ailleurs. Voulez-vous continuer ?`;
}
