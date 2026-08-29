/** Quiet placeholder that preserves page geometry while local state opens. */
export function PageContentSkeleton({ testId = "page-content-skeleton" }: { testId?: string }) {
  return (
    <div className="workspace-page-content-skeleton" data-testid={testId} role="status" aria-busy>
      <span className="ui-visually-hidden">Ouverture de la page…</span>
      <span className="workspace-skeleton workspace-skeleton--line" aria-hidden="true" />
      <span className="workspace-skeleton workspace-skeleton--line-short" aria-hidden="true" />
      <span className="workspace-skeleton workspace-skeleton--line" aria-hidden="true" />
    </div>
  );
}
