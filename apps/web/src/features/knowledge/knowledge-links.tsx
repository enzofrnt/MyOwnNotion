import type { PageKnowledgeSummary, Uuid } from "@myownnotion/domain";

export function KnowledgeLinks({
  summary,
  onNavigate,
}: {
  readonly summary: PageKnowledgeSummary;
  readonly onNavigate: (itemId: Uuid) => void;
}) {
  const renderList = (
    label: string,
    entries: PageKnowledgeSummary["incoming"] | PageKnowledgeSummary["outgoing"],
    direction: "incoming" | "outgoing",
  ) => (
    <section className="knowledge-links-section" aria-label={label}>
      <h3>{label}</h3>
      {entries.length === 0 ? (
        <p className="muted">No {label.toLocaleLowerCase()}.</p>
      ) : (
        <ul className="knowledge-link-list">
          {entries.map((entry) => {
            const itemId = direction === "incoming" ? entry.sourceItemId : entry.targetItemId;
            const name = direction === "incoming" ? entry.sourceName : entry.targetName;
            const state =
              direction === "incoming" ? entry.sourceAvailability : entry.targetAvailability;
            return (
              <li
                className="knowledge-link-list-item"
                key={`${entry.sourceItemId}-${entry.targetItemId}`}
              >
                <button
                  type="button"
                  disabled={state !== "active"}
                  onClick={() => onNavigate(itemId)}
                >
                  {name}
                </button>
                <span className="knowledge-link-count">
                  {entry.occurrenceCount} {entry.occurrenceCount === 1 ? "link" : "links"}
                </span>
                {state !== "active" ? (
                  <span className="knowledge-link-state" data-state={state}>
                    {state}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="knowledge-links" data-testid="knowledge-links">
      {renderList("Backlinks", summary.incoming, "incoming")}
      {renderList("Outgoing links", summary.outgoing, "outgoing")}
    </div>
  );
}
