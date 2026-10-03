import { classNames } from "../class-names.ts";

export interface SkeletonProps {
  readonly className?: string;
  readonly layout?: "lines" | "table" | "media";
  readonly rows?: number;
}

/** Decorative geometry; the owning status provides the loading announcement. */
export function Skeleton({ className, layout = "lines", rows = 3 }: SkeletonProps) {
  const count =
    layout === "media"
      ? 1
      : Number.isFinite(rows)
        ? Math.max(1, Math.min(20, Math.round(rows)))
        : 3;
  return (
    <div className={classNames("ui-skeleton", className)} data-layout={layout} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => `placeholder-${index}`).map((key) =>
        layout === "table" ? (
          <div className="ui-skeleton__row" key={key}>
            <span className="ui-skeleton__line" />
            <span className="ui-skeleton__line" />
          </div>
        ) : (
          <span className="ui-skeleton__line" key={key} />
        ),
      )}
    </div>
  );
}
