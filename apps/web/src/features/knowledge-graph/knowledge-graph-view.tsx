import type { ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import type { GraphCoverage, GraphScope } from "@myownnotion/graph";
import { useEffect, useMemo, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { AsyncState, Button } from "../../ui/primitives/index.ts";
import { GraphCanvas } from "./graph-canvas.tsx";
import {
  createDefaultGraphControlState,
  GraphControls,
  type GraphStructuredDimension,
  graphQueryFromControls,
} from "./graph-controls.tsx";
import { GRAPH_COPY } from "./graph-copy.ts";
import { GraphInspector } from "./graph-inspector.tsx";
import { GraphList } from "./graph-list.tsx";
import {
  type GraphPreferences,
  readGraphPreferences,
  writeGraphPreferences,
} from "./graph-preferences.ts";
import { useKnowledgeGraph } from "./use-knowledge-graph.ts";

function structuredLabel(field: string): string {
  if (field === "status") return "Statut";
  if (field === "dueDate") return "Échéance";
  if (field === "priority") return "Priorité";
  return field.startsWith("property:") ? field.slice("property:".length) : "Propriété";
}

function graphStructuredDimensions(
  source: ReturnType<typeof useKnowledgeGraph>["source"],
): GraphStructuredDimension[] {
  if (source === null) return [];
  const values = new Map<string, Set<string>>();
  for (const node of source.nodes) {
    for (const [field, value] of Object.entries(node.structured)) {
      if (value === null) continue;
      const candidates = values.get(field) ?? new Set<string>();
      if (candidates.size < 100) candidates.add(String(value));
      values.set(field, candidates);
    }
  }
  return [...values.entries()]
    .map(([field, candidates]) => {
      const ordered = [...candidates].toSorted((left, right) => left.localeCompare(right, "fr"));
      return {
        field,
        label: structuredLabel(field),
        kind:
          field === "dueDate" || ordered.every((value) => /^\d{4}-\d{2}-\d{2}/u.test(value))
            ? "date"
            : "value",
        values: ordered,
      } satisfies GraphStructuredDimension;
    })
    .toSorted((left, right) => left.label.localeCompare(right.label, "fr"));
}

export function GraphCoverageNotice({
  coverage,
  offline,
  onSynchronize,
}: {
  readonly coverage: GraphCoverage;
  readonly offline: boolean;
  readonly onSynchronize?: () => void;
}) {
  return (
    <p className="knowledge-graph-coverage" data-coverage={coverage.state} role="status">
      <strong>
        {coverage.state === "complete" ? "Vue complète sur cet appareil" : "Vue partielle"}
      </strong>
      {coverage.state === "partial" ? (
        <span>
          {coverage.reason === "initial-sync"
            ? "La première synchronisation n’est pas terminée."
            : coverage.reason === "missing-local-values"
              ? "Certaines valeurs de filtre ne sont pas présentes localement."
              : "La projection doit être recalculée."}
        </span>
      ) : null}
      {coverage.state === "partial" && !offline && onSynchronize !== undefined ? (
        <Button size="compact" variant="ghost" onClick={onSynchronize}>
          Synchroniser
        </Button>
      ) : null}
      {offline ? <span>Hors ligne · les données déjà présentes restent disponibles.</span> : null}
    </p>
  );
}

export function KnowledgeGraphView({
  service,
  items,
  initialScope,
  onOpenItem,
}: {
  readonly service: LocalContentService;
  readonly items: readonly ProjectedItem[];
  readonly initialScope: GraphScope;
  readonly onOpenItem: (itemId: Uuid) => void;
}) {
  const [preferences, setPreferences] = useState<GraphPreferences>(() => readGraphPreferences());
  const [controls, setControls] = useState(() => {
    const initial = createDefaultGraphControlState(initialScope);
    initial.edgeLayers = [...preferences.edgeLayers];
    initial.nodeKinds = [...preferences.nodeKinds];
    initial.relationTypes = [...preferences.relationTypes];
    initial.includeIsolated = preferences.includeIsolated;
    return initial;
  });
  const [selectedId, setSelectedId] = useState<Uuid | null>(
    initialScope.kind === "neighborhood" ? initialScope.centerId : null,
  );
  const query = useMemo(() => {
    const next = graphQueryFromControls(controls);
    if (next.scope.kind === "neighborhood") {
      next.scope = { ...next.scope, depth: preferences.depth };
    }
    next.filters.edgeLayers = [...preferences.edgeLayers];
    next.filters.nodeKinds = [...preferences.nodeKinds];
    next.filters.relationTypes = [...preferences.relationTypes];
    next.filters.includeIsolated = preferences.includeIsolated || controls.includeIsolated;
    return next;
  }, [controls, preferences]);
  const graph = useKnowledgeGraph(service, query);

  useEffect(() => {
    const next = createDefaultGraphControlState(initialScope);
    next.edgeLayers = [...preferences.edgeLayers];
    next.nodeKinds = [...preferences.nodeKinds];
    next.relationTypes = [...preferences.relationTypes];
    next.includeIsolated = preferences.includeIsolated;
    setControls(next);
    setSelectedId(initialScope.kind === "neighborhood" ? initialScope.centerId : null);
  }, [
    initialScope,
    preferences.edgeLayers,
    preferences.includeIsolated,
    preferences.nodeKinds,
    preferences.relationTypes,
  ]);

  useEffect(() => {
    if (graph.projection === null) return;
    if (selectedId === null) return;
    if (graph.projection.nodes.some(({ id }) => id === selectedId)) return;
    setSelectedId(graph.projection.focusId ?? graph.projection.nodes[0]?.id ?? null);
  }, [graph.projection, selectedId]);

  const setPreference = (next: GraphPreferences): void => {
    setPreferences(next);
    writeGraphPreferences(next);
  };
  const relationTypes =
    graph.source === null
      ? []
      : [...new Set(graph.source.edges.map(({ relationType }) => relationType))].toSorted();
  const structuredDimensions = graphStructuredDimensions(graph.source);
  const selected = graph.projection?.nodes.find(({ id }) => id === selectedId) ?? null;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <section className="knowledge-graph" data-testid="knowledge-graph">
      <header className="knowledge-graph__header">
        <div className="knowledge-graph__heading">
          <span>Vue privée</span>
          <h1>{GRAPH_COPY.title}</h1>
          <p>
            {initialScope.kind === "workspace"
              ? GRAPH_COPY.globalSubtitle
              : GRAPH_COPY.localSubtitle}
          </p>
        </div>
        <fieldset className="knowledge-graph__mode">
          <legend className="sr-only">Représentation du graphe</legend>
          <Button
            variant={preferences.mode === "canvas" ? "primary" : "ghost"}
            aria-pressed={preferences.mode === "canvas"}
            onClick={() => setPreference({ ...preferences, mode: "canvas" })}
          >
            <AppIcon name="graph" /> Carte
          </Button>
          <Button
            variant={preferences.mode === "list" ? "primary" : "ghost"}
            aria-pressed={preferences.mode === "list"}
            onClick={() => setPreference({ ...preferences, mode: "list" })}
          >
            <AppIcon name="list" /> Liste
          </Button>
        </fieldset>
      </header>

      <GraphControls
        state={controls}
        items={items}
        relationTypes={relationTypes}
        structuredDimensions={structuredDimensions}
        onChange={(next) => {
          setControls(next);
          setPreference({
            ...preferences,
            depth: next.scope.kind === "neighborhood" ? next.scope.depth : preferences.depth,
            edgeLayers: next.edgeLayers,
            nodeKinds: next.nodeKinds,
            relationTypes: next.relationTypes,
            includeIsolated: next.includeIsolated,
          });
        }}
      />

      {graph.projection === null && graph.status === "loading" ? (
        <AsyncState kind="loading" title="Construction du graphe local…" />
      ) : graph.projection === null ? (
        <AsyncState
          kind="error"
          title="Le graphe est indisponible sur cet appareil."
          description="La dernière projection sûre n’est pas disponible localement."
          action={<Button onClick={graph.retry}>Recalculer</Button>}
        />
      ) : (
        <>
          <GraphCoverageNotice
            coverage={graph.projection.coverage}
            offline={offline}
            onSynchronize={() => void service.synchronize()}
          />
          {graph.status === "rebuilding" ? (
            <AsyncState
              compact
              kind="loading"
              title="Reconstruction en cours — la dernière vue sûre reste affichée."
            />
          ) : null}
          {graph.status === "stale" ? (
            <AsyncState
              compact
              kind="error"
              title="La dernière vue sûre est conservée, mais elle peut être obsolète."
              action={<Button onClick={graph.retry}>Recalculer</Button>}
            />
          ) : null}
          <p className="knowledge-graph__summary">
            {graph.projection.summary.visibleNodeCount} élément
            {graph.projection.summary.visibleNodeCount > 1 ? "s" : ""} affiché
            {graph.projection.summary.visibleNodeCount > 1 ? "s" : ""} sur{" "}
            {graph.projection.summary.candidateNodeCount} ·{" "}
            {graph.projection.summary.candidateRelationCount} relation
            {graph.projection.summary.candidateRelationCount > 1 ? "s" : ""}
          </p>
          {graph.projection.truncation.truncated ? (
            <p className="knowledge-graph__limit" role="status">
              Vue bornée : {graph.projection.truncation.omittedNodes} éléments et{" "}
              {graph.projection.truncation.omittedEdges} relations supplémentaires. Réduisez le
              périmètre ou ajoutez un filtre.
            </p>
          ) : null}
          {graph.projection.nodes.length === 0 ? (
            <AsyncState
              kind="empty"
              title={GRAPH_COPY.empty}
              description="Affichez les éléments isolés ou réinitialisez les filtres."
            />
          ) : (
            <div className="knowledge-graph__workspace">
              <div className="knowledge-graph__representation">
                {preferences.mode === "canvas" ? (
                  <GraphCanvas
                    projection={graph.projection}
                    selectedId={selectedId}
                    initialZoom={preferences.zoom}
                    onSelect={setSelectedId}
                    onOpen={onOpenItem}
                    onClearSelection={() => setSelectedId(null)}
                    onZoomChange={(zoom) => setPreference({ ...preferences, zoom })}
                  />
                ) : (
                  <GraphList
                    projection={graph.projection}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                )}
              </div>
              {selected === null ? null : (
                <GraphInspector
                  node={selected}
                  nodes={graph.projection.nodes}
                  edges={graph.projection.edges}
                  onOpen={(node) => onOpenItem(node.id)}
                  onClose={() => {
                    document
                      .querySelector<SVGGElement>(`[data-graph-node="${selected.id}"]`)
                      ?.focus();
                    setSelectedId(null);
                  }}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
