import type { ProjectedItem } from "@myownnotion/client-core";
import {
  defaultGraphQuery,
  describeRelationType,
  type GraphEdgeLayer,
  type GraphNodeKind,
  type GraphQuery,
  type GraphScope,
  type StructuredGraphFilter,
} from "@myownnotion/graph";
import { Button } from "../../ui/primitives/index.ts";
import { GRAPH_KIND_LABELS } from "./graph-copy.ts";

export interface GraphControlState {
  initialScope: GraphScope;
  scope: GraphScope;
  edgeLayers: GraphEdgeLayer[];
  nodeKinds: GraphNodeKind[];
  relationTypes: string[];
  mediaTypes: string[];
  lifecycle: "active" | "including-trashed";
  structured: StructuredGraphFilter[];
  includeIsolated: boolean;
}

export interface GraphStructuredDimension {
  readonly field: string;
  readonly label: string;
  readonly kind: "date" | "value";
  readonly values: readonly string[];
}

export function createDefaultGraphControlState(initialScope: GraphScope): GraphControlState {
  return {
    initialScope,
    scope: initialScope,
    edgeLayers: ["knowledge"],
    nodeKinds: [],
    relationTypes: [],
    mediaTypes: [],
    lifecycle: "active",
    structured: [],
    includeIsolated: false,
  };
}

export function resetGraphControlState(state: GraphControlState): GraphControlState {
  return createDefaultGraphControlState(state.initialScope);
}

export function graphControlFilterCount(state: GraphControlState): number {
  const defaults = createDefaultGraphControlState(state.initialScope);
  let count = 0;
  if (state.scope.kind !== defaults.scope.kind) count += 1;
  if (state.edgeLayers.join() !== defaults.edgeLayers.join()) count += 1;
  if (state.nodeKinds.length > 0) count += 1;
  if (state.relationTypes.length > 0) count += 1;
  if (state.mediaTypes.length > 0) count += 1;
  if (state.lifecycle !== defaults.lifecycle) count += 1;
  if (state.structured.length > 0) count += 1;
  if (state.includeIsolated) count += 1;
  if (state.scope.kind === "neighborhood" && state.scope.depth !== 2) count += 1;
  return count;
}

export function graphQueryFromControls(state: GraphControlState): GraphQuery {
  const query = defaultGraphQuery(state.scope);
  query.filters.edgeLayers = [...state.edgeLayers];
  query.filters.nodeKinds = [...state.nodeKinds];
  query.filters.relationTypes = [...state.relationTypes];
  query.filters.mediaTypes = [...state.mediaTypes];
  query.filters.lifecycle = state.lifecycle;
  query.filters.structured = [...state.structured];
  query.filters.includeIsolated = state.includeIsolated;
  return query;
}

const KIND_OPTIONS = Object.entries(GRAPH_KIND_LABELS) as Array<[GraphNodeKind, string]>;

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  return checked
    ? [...new Set([...values, value])]
    : values.filter((candidate) => candidate !== value);
}

export function GraphControls({
  state,
  items,
  relationTypes,
  structuredDimensions,
  onChange,
}: {
  readonly state: GraphControlState;
  readonly items: readonly ProjectedItem[];
  readonly relationTypes: readonly string[];
  readonly structuredDimensions: readonly GraphStructuredDimension[];
  readonly onChange: (state: GraphControlState) => void;
}) {
  const scope = state.scope;
  const selectedScopeId =
    scope.kind === "branch"
      ? scope.rootId
      : scope.kind === "neighborhood"
        ? scope.centerId
        : items[0]?.id;
  return (
    <div className="knowledge-graph-controls__grid">
      <label>
        Périmètre
        <select
          value={state.scope.kind}
          onChange={(event) => {
            const kind = event.currentTarget.value;
            const itemId = selectedScopeId ?? items[0]?.id;
            const scope: GraphScope =
              kind === "workspace" || itemId === undefined
                ? { kind: "workspace" }
                : kind === "branch"
                  ? { kind: "branch", rootId: itemId }
                  : kind === "selection"
                    ? { kind: "selection", itemIds: [itemId] }
                    : { kind: "neighborhood", centerId: itemId, depth: 2 };
            onChange({ ...state, scope });
          }}
        >
          <option value="workspace">Espace complet</option>
          <option value="branch">Branche et descendants</option>
          <option value="neighborhood">Voisinage</option>
          <option value="selection">Sélection</option>
        </select>
      </label>
      {scope.kind === "branch" || scope.kind === "neighborhood" ? (
        <label>
          Élément de départ
          <select
            value={selectedScopeId}
            onChange={(event) => {
              const itemId = event.currentTarget.value as ProjectedItem["id"];
              onChange({
                ...state,
                scope:
                  scope.kind === "branch"
                    ? { kind: "branch", rootId: itemId }
                    : { kind: "neighborhood", centerId: itemId, depth: scope.depth },
              });
            }}
          >
            {items.slice(0, 200).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {scope.kind === "selection" ? (
        <fieldset className="knowledge-graph-controls__selection">
          <legend>Éléments sélectionnés</legend>
          <span className="muted">
            {scope.itemIds.length} élément{scope.itemIds.length > 1 ? "s" : ""}
          </span>
          <div>
            {items.slice(0, 200).map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={scope.itemIds.includes(item.id)}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      scope: {
                        kind: "selection",
                        itemIds: toggled(scope.itemIds, item.id, event.currentTarget.checked),
                      },
                    })
                  }
                />
                {item.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {scope.kind === "neighborhood" ? (
        <label>
          Profondeur
          <select
            value={scope.depth}
            onChange={(event) =>
              onChange({
                ...state,
                scope: {
                  kind: "neighborhood",
                  centerId: scope.centerId,
                  depth: Number(event.currentTarget.value) as 1 | 2 | 3,
                },
              })
            }
          >
            <option value={1}>1 niveau</option>
            <option value={2}>2 niveaux</option>
            <option value={3}>3 niveaux</option>
          </select>
        </label>
      ) : null}
      <fieldset>
        <legend>Calques du graphe</legend>
        {(
          [
            ["knowledge", "Connaissances"],
            ["hierarchy", "Hiérarchie"],
            ["attachment", "Pièces jointes"],
          ] as const
        ).map(([layer, label]) => (
          <label key={layer}>
            <input
              type="checkbox"
              checked={state.edgeLayers.includes(layer)}
              onChange={(event) =>
                onChange({
                  ...state,
                  edgeLayers: toggled(state.edgeLayers, layer, event.currentTarget.checked),
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Types d’élément</legend>
        {KIND_OPTIONS.map(([kind, label]) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={state.nodeKinds.includes(kind)}
              onChange={(event) =>
                onChange({
                  ...state,
                  nodeKinds: toggled(state.nodeKinds, kind, event.currentTarget.checked),
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      {relationTypes.length > 0 ? (
        <fieldset>
          <legend>Types de relation</legend>
          {relationTypes.map((type) => (
            <label key={type} title={type}>
              <input
                type="checkbox"
                checked={state.relationTypes.includes(type)}
                onChange={(event) =>
                  onChange({
                    ...state,
                    relationTypes: toggled(state.relationTypes, type, event.currentTarget.checked),
                  })
                }
              />
              {describeRelationType(type).label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {structuredDimensions.map((dimension) => {
        const equals = state.structured.find(
          ({ field, operator }) => field === dimension.field && operator === "equals",
        );
        const after = state.structured.find(
          ({ field, operator }) => field === dimension.field && operator === "after",
        );
        const before = state.structured.find(
          ({ field, operator }) => field === dimension.field && operator === "before",
        );
        const replace = (
          operator: StructuredGraphFilter["operator"],
          value: string,
        ): StructuredGraphFilter[] => [
          ...state.structured.filter(
            (filter) => !(filter.field === dimension.field && filter.operator === operator),
          ),
          ...(value === "" ? [] : [{ field: dimension.field, operator, value }]),
        ];
        return dimension.kind === "date" ? (
          <fieldset key={dimension.field}>
            <legend>{dimension.label}</legend>
            <label>
              Après le
              <input
                type="date"
                value={String(after?.value ?? "")}
                onChange={(event) =>
                  onChange({
                    ...state,
                    structured: replace("after", event.currentTarget.value),
                  })
                }
              />
            </label>
            <label>
              Avant le
              <input
                type="date"
                value={String(before?.value ?? "")}
                onChange={(event) =>
                  onChange({
                    ...state,
                    structured: replace("before", event.currentTarget.value),
                  })
                }
              />
            </label>
          </fieldset>
        ) : (
          <label key={dimension.field}>
            {dimension.label}
            <select
              value={String(equals?.value ?? "")}
              onChange={(event) =>
                onChange({
                  ...state,
                  structured: replace("equals", event.currentTarget.value),
                })
              }
            >
              <option value="">Toutes les valeurs</option>
              {dimension.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <label>
        Format de fichier
        <select
          value={state.mediaTypes[0] ?? ""}
          onChange={(event) =>
            onChange({
              ...state,
              mediaTypes: event.currentTarget.value === "" ? [] : [event.currentTarget.value],
            })
          }
        >
          <option value="">Tous</option>
          <option value="image/">Images</option>
          <option value="audio/">Audio</option>
          <option value="video/">Vidéos</option>
          <option value="application/pdf">PDF</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={state.includeIsolated}
          onChange={(event) => onChange({ ...state, includeIsolated: event.currentTarget.checked })}
        />
        Afficher les éléments isolés
      </label>
      <label>
        <input
          type="checkbox"
          checked={state.lifecycle === "including-trashed"}
          onChange={(event) =>
            onChange({
              ...state,
              lifecycle: event.currentTarget.checked ? "including-trashed" : "active",
            })
          }
        />
        Inclure la corbeille
      </label>
      <Button variant="ghost" onClick={() => onChange(resetGraphControlState(state))}>
        Réinitialiser les filtres
      </Button>
    </div>
  );
}
