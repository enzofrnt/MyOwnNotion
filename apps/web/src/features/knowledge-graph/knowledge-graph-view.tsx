import type { ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import type { GraphCoverage, GraphScope } from "@myownnotion/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AppIcon } from "../../ui/icons.tsx";
import {
  AsyncState,
  Button,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../ui/primitives/index.ts";
import { GraphCanvas, type GraphCanvasHandle } from "./graph-canvas.tsx";
import {
  createDefaultGraphControlState,
  GraphControls,
  type GraphStructuredDimension,
  graphControlFilterCount,
  graphQueryFromControls,
} from "./graph-controls.tsx";
import { GRAPH_COPY } from "./graph-copy.ts";
import { GraphForceControls } from "./graph-force-controls.tsx";
import { GraphInspector } from "./graph-inspector.tsx";
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
  const [controlsOpen, setControlsOpen] = useState(false);
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
  const canvasRef = useRef<GraphCanvasHandle>(null);

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

  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const zoomSaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(zoomSaveTimer.current), []);
  const setPreference = (next: GraphPreferences): void => {
    preferencesRef.current = next;
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
  const activeFilterCount = graphControlFilterCount(controls);

  return (
    <section className="knowledge-graph" data-testid="knowledge-graph">
      <div className="knowledge-graph__stage">
        {graph.projection === null && graph.status === "loading" ? (
          <AsyncState kind="loading" title="Construction du graphe local…" />
        ) : graph.projection === null ? (
          <AsyncState
            kind="error"
            title="Le graphe est indisponible sur cet appareil."
            description="La dernière projection sûre n’est pas disponible localement."
            action={<Button onClick={graph.retry}>Recalculer</Button>}
          />
        ) : graph.projection.nodes.length === 0 ? (
          <AsyncState
            kind="empty"
            title={GRAPH_COPY.empty}
            description="Affichez les éléments isolés ou réinitialisez les filtres."
          />
        ) : (
          <GraphCanvas
            ref={canvasRef}
            projection={graph.projection}
            selectedId={selectedId}
            initialZoom={preferences.zoom}
            forces={preferences.forces}
            onSelect={setSelectedId}
            onOpen={onOpenItem}
            onClearSelection={() => setSelectedId(null)}
            onZoomChange={(zoom) => {
              window.clearTimeout(zoomSaveTimer.current);
              zoomSaveTimer.current = window.setTimeout(() => {
                setPreference({ ...preferencesRef.current, zoom });
              }, 400);
            }}
          />
        )}

        <div className="knowledge-graph__hud">
          <Button
            size="compact"
            variant={controlsOpen ? "primary" : "ghost"}
            aria-expanded={controlsOpen}
            aria-controls="knowledge-graph-filters"
            data-testid="graph-filters-toggle"
            onClick={() => setControlsOpen((open) => !open)}
          >
            <AppIcon name="settings" /> Filtres
            {activeFilterCount > 0 ? (
              <span className="knowledge-graph__filter-count">{activeFilterCount}</span>
            ) : null}
          </Button>
        </div>

        {graph.projection === null ? null : (
          <div className="knowledge-graph__status">
            <PopoverRoot placement="bottom-start">
              <PopoverTrigger
                className="knowledge-graph__status-toggle"
                data-size="square"
                data-testid="graph-status-toggle"
                data-tone={
                  graph.projection.coverage.state !== "complete" ||
                  graph.projection.truncation.truncated ||
                  graph.status === "stale"
                    ? "warn"
                    : undefined
                }
                aria-label={
                  graph.projection.truncation.truncated
                    ? `Informations du graphe, vue bornée : ${graph.projection.truncation.omittedNodes} éléments et ${graph.projection.truncation.omittedEdges} relations supplémentaires`
                    : graph.projection.coverage.state === "complete"
                      ? "Informations du graphe, vue complète sur cet appareil"
                      : "Informations du graphe, vue partielle"
                }
              >
                <AppIcon name="info" />
              </PopoverTrigger>
              <PopoverContent className="knowledge-graph__status-panel" aria-label="État du graphe">
                <div className="knowledge-graph__view-controls">
                  <span>{Math.round(preferences.zoom * 100)} %</span>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => canvasRef.current?.fitView()}
                  >
                    Ajuster
                  </Button>
                </div>
                <GraphForceControls
                  forces={preferences.forces}
                  onChange={(next) => setPreference({ ...preferences, forces: next })}
                />
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
                {graph.projection.truncation.truncated ? (
                  <p className="knowledge-graph__limit" role="status">
                    Vue bornée : {graph.projection.truncation.omittedNodes} éléments et{" "}
                    {graph.projection.truncation.omittedEdges} relations supplémentaires. Réduisez
                    le périmètre ou ajoutez un filtre.
                  </p>
                ) : null}
              </PopoverContent>
            </PopoverRoot>
          </div>
        )}

        {controlsOpen ? (
          <aside
            id="knowledge-graph-filters"
            className="knowledge-graph-controls"
            aria-label="Filtres et périmètre"
          >
            <header className="knowledge-graph-controls__header">
              <h2>Filtres et périmètre</h2>
              <Button
                size="square"
                variant="ghost"
                aria-label="Fermer les filtres"
                onClick={() => setControlsOpen(false)}
              >
                <AppIcon name="close" />
              </Button>
            </header>
            {graph.projection === null ? null : (
              <p className="knowledge-graph__summary">
                {graph.projection.summary.visibleNodeCount} élément
                {graph.projection.summary.visibleNodeCount > 1 ? "s" : ""} affiché
                {graph.projection.summary.visibleNodeCount > 1 ? "s" : ""} sur{" "}
                {graph.projection.summary.candidateNodeCount} ·{" "}
                {graph.projection.summary.candidateRelationCount} relation
                {graph.projection.summary.candidateRelationCount > 1 ? "s" : ""}
              </p>
            )}
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
          </aside>
        ) : null}

        {selected === null || graph.projection === null ? null : (
          <GraphInspector
            node={selected}
            nodes={graph.projection.nodes}
            edges={graph.projection.edges}
            onOpen={(node) => onOpenItem(node.id)}
            onClose={() => {
              document.querySelector<SVGGElement>(`[data-graph-node="${selected.id}"]`)?.focus();
              setSelectedId(null);
            }}
          />
        )}
      </div>
    </section>
  );
}
