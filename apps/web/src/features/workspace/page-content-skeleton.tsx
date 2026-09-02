/** Quiet placeholder that preserves page geometry while local state opens. */
export function PageContentSkeleton({
  hasIcon = false,
  testId = "page-content-skeleton",
  variant = "body",
}: {
  readonly hasIcon?: boolean;
  readonly testId?: string;
  readonly variant?: "page" | "body";
}) {
  const lines = (
    <div className="workspace-page-content-skeleton" aria-hidden="true">
      <span className="workspace-skeleton workspace-skeleton--line" />
      <span className="workspace-skeleton workspace-skeleton--line-short" />
      <span className="workspace-skeleton workspace-skeleton--line" />
    </div>
  );

  if (variant === "body") {
    return (
      <div data-testid={testId} role="status" aria-busy="true">
        <span className="ui-visually-hidden">Ouverture de la page…</span>
        {lines}
      </div>
    );
  }

  return (
    <div
      className="workspace-page-opening-skeleton"
      data-testid={testId}
      role="status"
      aria-busy="true"
    >
      <span className="ui-visually-hidden">Ouverture de la page…</span>
      <div className="workspace-page-title__path" aria-hidden="true">
        <span className="workspace-skeleton workspace-skeleton--crumb" />
      </div>
      <div className="workspace-page-title__body" aria-hidden="true">
        {hasIcon ? <span className="workspace-skeleton workspace-skeleton--emoji" /> : null}
        <span className="workspace-skeleton workspace-skeleton--title" />
        <span className="workspace-skeleton workspace-skeleton--kind" />
      </div>
      {lines}
    </div>
  );
}
