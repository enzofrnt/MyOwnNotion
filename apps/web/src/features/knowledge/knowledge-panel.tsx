import type { KnowledgeGraphModel, PageKnowledgeSummary, Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { KnowledgeGraph } from "./knowledge-graph.tsx";
import { KnowledgeLinks } from "./knowledge-links.tsx";

interface KnowledgeState {
  readonly summary: PageKnowledgeSummary;
  readonly graph: KnowledgeGraphModel;
}

export function KnowledgePanel({
  service,
  itemId,
  onNavigate,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  readonly onNavigate: (itemId: Uuid) => void;
}) {
  const [mode, setMode] = useState<"local" | "global">("local");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<KnowledgeState | null>(null);
  const refresh = useCallback(async () => {
    const [summary, graph] = await Promise.all([
      service.getPageKnowledge(itemId),
      service.getKnowledgeGraph(mode, itemId, query),
    ]);
    setState({ summary, graph });
  }, [itemId, mode, query, service]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) {
        await refresh();
      }
    };
    void run();
    const unsubscribe = service.subscribe(() => void run());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refresh, service]);

  return (
    <section className="panel knowledge-panel" aria-label="Page knowledge">
      <div className="knowledge-panel-heading">
        <div>
          <h2>Page knowledge</h2>
          <p className="muted">Links, backlinks, and the local-first knowledge graph.</p>
        </div>
        <fieldset className="knowledge-graph-modes">
          <legend className="visually-hidden">Knowledge graph scope</legend>
          <button type="button" aria-pressed={mode === "local"} onClick={() => setMode("local")}>
            Local graph
          </button>
          <button type="button" aria-pressed={mode === "global"} onClick={() => setMode("global")}>
            Global graph
          </button>
        </fieldset>
      </div>
      {state === null ? (
        <p role="status">Loading page knowledge…</p>
      ) : (
        <>
          <KnowledgeLinks summary={state.summary} onNavigate={onNavigate} />
          <label className="knowledge-filter">
            Filter graph pages
            <input
              type="search"
              value={query}
              placeholder="Page name"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <KnowledgeGraph graph={state.graph} onNavigate={onNavigate} />
        </>
      )}
    </section>
  );
}
