/** A view the source definition stores, without a presentation source id. */
interface DefinitionView {
  readonly id: string;
}

/** A view the container presentation stores, always bound to a source. */
interface PresentationView extends DefinitionView {
  readonly sourceId: string;
}

/**
 * A definition replacement rewrites the owner's presentation from
 * `definition.views`. Keep every presentation view in that list so a property
 * edit does not drop the other tabs.
 */
export function definitionViewsPreservingPresentation<T extends DefinitionView>(
  sourceViews: readonly T[],
  presentationViews: readonly (T & PresentationView)[],
  selectedViewId: string,
  nextView: T | undefined,
): T[] {
  const sourceById = new Map(sourceViews.map((view) => [view.id, view]));
  const seen = new Set<string>();
  const views: T[] = [];
  for (const view of presentationViews) {
    seen.add(view.id);
    if (view.id === selectedViewId && nextView !== undefined) {
      views.push({ ...nextView, id: view.id });
      continue;
    }
    const fromSource = sourceById.get(view.id);
    views.push(fromSource ?? withoutSourceId(view));
  }
  for (const view of sourceViews) {
    if (seen.has(view.id)) continue;
    views.push(view.id === selectedViewId && nextView !== undefined ? nextView : view);
  }
  return views;
}

function withoutSourceId<T extends PresentationView>(view: T): T {
  const { sourceId: _sourceId, ...rest } = view;
  return rest as T;
}
