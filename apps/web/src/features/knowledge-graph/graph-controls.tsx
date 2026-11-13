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
import type { ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { PopoverContent, PopoverRoot, PopoverTrigger, Switch } from "../../ui/primitives/index.ts";
import { NativeSelect } from "../../ui/primitives/native-select.tsx";
import { GRAPH_HELP, GRAPH_KIND_LABELS, GRAPH_LAYER_LABELS } from "./graph-copy.ts";

export interface GraphControlState {
  initialScope: GraphScope;
  /** Kind of the element a local graph was opened on; `null` for the global graph. */
  initialCenterKind: GraphNodeKind | null;
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

/**
 * Layers a local graph starts with. A page's neighbourhood is its knowledge
 * links only (spec 010, US2 scenario 6). A folder or a database is mostly made
 * of what it contains, so its structure is part of what the owner asks to see.
 */
export function defaultGraphEdgeLayers(
  scope: GraphScope,
  centerKind: GraphNodeKind | null,
): GraphEdgeLayer[] {
  if (scope.kind !== "neighborhood") return ["knowledge"];
  return centerKind === "folder" || centerKind === "database" || centerKind === "database_view"
    ? ["knowledge", "hierarchy"]
    : ["knowledge"];
}

export function createDefaultGraphControlState(
  initialScope: GraphScope,
  initialCenterKind: GraphNodeKind | null = null,
): GraphControlState {
  return {
    initialScope,
    initialCenterKind,
    scope: initialScope,
    edgeLayers: defaultGraphEdgeLayers(initialScope, initialCenterKind),
    nodeKinds: [],
    relationTypes: [],
    mediaTypes: [],
    lifecycle: "active",
    structured: [],
    includeIsolated: false,
  };
}

export function resetGraphControlState(state: GraphControlState): GraphControlState {
  return createDefaultGraphControlState(state.initialScope, state.initialCenterKind);
}

export function graphControlFilterCount(state: GraphControlState): number {
  const defaults = createDefaultGraphControlState(state.initialScope, state.initialCenterKind);
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
const LAYER_OPTIONS = Object.entries(GRAPH_LAYER_LABELS) as Array<[GraphEdgeLayer, string]>;

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  return checked
    ? [...new Set([...values, value])]
    : values.filter((candidate) => candidate !== value);
}

/** The small “i”: what a setting shows, in plain language, on click or keyboard. */
function HelpHint({ about, children }: { readonly about: string; readonly children: string }) {
  return (
    <PopoverRoot placement="left-start">
      <PopoverTrigger className="graph-panel__help" aria-label={`À propos de ${about}`}>
        <AppIcon name="info" size="small" />
      </PopoverTrigger>
      <PopoverContent className="graph-panel__help-text" aria-label={`À propos de ${about}`}>
        <p>{children}</p>
      </PopoverContent>
    </PopoverRoot>
  );
}

/** One settings line: what it is on the left, its control on the right. */
function PanelRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped control is passed as children.
    <label className="graph-panel__row">
      <span className="graph-panel__row-label">{label}</span>
      <span className="graph-panel__row-control">{children}</span>
    </label>
  );
}

function SwitchRow({
  label,
  help,
  swatch,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly help?: string | undefined;
  readonly swatch?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="graph-panel__row">
      {swatch}
      <span className="graph-panel__row-label">{label}</span>
      {help === undefined ? null : <HelpHint about={label}>{help}</HelpHint>}
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A filter value that is either part of the selection or not, menu style. */
function CheckRow({
  label,
  title,
  help,
  swatch,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly title?: string;
  readonly help?: string | undefined;
  readonly swatch?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="graph-panel__check-row">
      {/* biome-ignore lint/a11y/useSemanticElements: a menu-style row with a trailing check mark, not a boxed native checkbox. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        title={title}
        className="graph-panel__row graph-panel__row--action"
        onClick={() => onChange(!checked)}
      >
        {swatch}
        <span className="graph-panel__row-label">{label}</span>
        {checked ? <AppIcon className="graph-panel__check" name="check" size="small" /> : null}
      </button>
      {help === undefined ? null : <HelpHint about={label}>{help}</HelpHint>}
    </div>
  );
}

function SectionTitle({
  children,
  help,
  aside,
  all,
}: {
  readonly children: string;
  readonly help?: string | undefined;
  readonly aside?: string | undefined;
  /** “Tous”: pressed while nothing is singled out; pressing it clears the selection. */
  readonly all?: { readonly active: boolean; readonly onSelect: () => void } | undefined;
}) {
  return (
    <div className="graph-panel__section">
      <span className="graph-panel__section-title">{children}</span>
      {help === undefined ? null : <HelpHint about={children}>{help}</HelpHint>}
      {aside === undefined ? null : <span className="graph-panel__section-aside">{aside}</span>}
      {all === undefined ? null : (
        <button
          type="button"
          className="graph-panel__all"
          aria-pressed={all.active}
          aria-label={`${children} : tous`}
          onClick={all.onSelect}
        >
          Tous
        </button>
      )}
    </div>
  );
}

export function GraphNodeSwatch({ kind }: { readonly kind: GraphNodeKind }) {
  return <span className="graph-swatch graph-swatch--node" data-kind={kind} aria-hidden="true" />;
}

export function GraphEdgeSwatch({ relation }: { readonly relation: string }) {
  return (
    <svg
      className="graph-swatch graph-swatch--edge"
      data-relation={relation}
      viewBox="0 0 22 6"
      aria-hidden="true"
    >
      <line x1="1" y1="3" x2="21" y2="3" />
    </svg>
  );
}

/** Relation drawn for each structural layer, so its switch shows the same line as the map. */
const LAYER_RELATION: Readonly<Record<GraphEdgeLayer, string>> = {
  knowledge: "page:link",
  hierarchy: "hierarchy:contains",
  attachment: "file:attachment",
};

export function GraphControls({
  state,
  items,
  relationTypes,
  structuredDimensions,
  onChange,
}: {
  readonly state: GraphControlState;
  readonly items: readonly Pick<ProjectedItem, "id" | "name">[];
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
    <div className="graph-panel__body">
      <PanelRow label="Périmètre">
        <NativeSelect
          density="compact"
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
        </NativeSelect>
      </PanelRow>
      {scope.kind === "branch" || scope.kind === "neighborhood" ? (
        <PanelRow label="Élément de départ">
          <NativeSelect
            density="compact"
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
          </NativeSelect>
        </PanelRow>
      ) : null}
      {scope.kind === "neighborhood" ? (
        <PanelRow label="Profondeur">
          <NativeSelect
            density="compact"
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
          </NativeSelect>
        </PanelRow>
      ) : null}
      {scope.kind === "selection" ? (
        <>
          <SectionTitle
            aside={`${scope.itemIds.length} élément${scope.itemIds.length > 1 ? "s" : ""}`}
          >
            Éléments sélectionnés
          </SectionTitle>
          <div className="graph-panel__scroll">
            {items.slice(0, 200).map((item) => (
              <CheckRow
                key={item.id}
                label={item.name}
                checked={scope.itemIds.includes(item.id)}
                onChange={(checked) =>
                  onChange({
                    ...state,
                    scope: {
                      kind: "selection",
                      itemIds: toggled(scope.itemIds, item.id, checked),
                    },
                  })
                }
              />
            ))}
          </div>
        </>
      ) : null}

      <hr className="graph-panel__rule" />
      <SectionTitle help={GRAPH_HELP.layers}>Calques du graphe</SectionTitle>
      {LAYER_OPTIONS.map(([layer, label]) => (
        <SwitchRow
          key={layer}
          label={label}
          help={GRAPH_HELP.layer[layer]}
          swatch={<GraphEdgeSwatch relation={LAYER_RELATION[layer]} />}
          checked={state.edgeLayers.includes(layer)}
          onChange={(checked) =>
            onChange({ ...state, edgeLayers: toggled(state.edgeLayers, layer, checked) })
          }
        />
      ))}

      <hr className="graph-panel__rule" />
      <SectionTitle
        help={GRAPH_HELP.kinds}
        all={{
          active: state.nodeKinds.length === 0,
          onSelect: () => onChange({ ...state, nodeKinds: [] }),
        }}
      >
        Types d’élément
      </SectionTitle>
      {KIND_OPTIONS.map(([kind, label]) => (
        <CheckRow
          key={kind}
          label={label}
          swatch={<GraphNodeSwatch kind={kind} />}
          checked={state.nodeKinds.includes(kind)}
          onChange={(checked) =>
            onChange({ ...state, nodeKinds: toggled(state.nodeKinds, kind, checked) })
          }
        />
      ))}

      {relationTypes.length > 0 ? (
        <>
          <hr className="graph-panel__rule" />
          <SectionTitle
            help={GRAPH_HELP.relations}
            all={{
              active: state.relationTypes.length === 0,
              onSelect: () => onChange({ ...state, relationTypes: [] }),
            }}
          >
            Types de relation
          </SectionTitle>
          {relationTypes.map((type) => (
            <CheckRow
              key={type}
              label={describeRelationType(type).label}
              title={type}
              help={GRAPH_HELP.relation[type]}
              swatch={<GraphEdgeSwatch relation={type} />}
              checked={state.relationTypes.includes(type)}
              onChange={(checked) =>
                onChange({
                  ...state,
                  relationTypes: toggled(state.relationTypes, type, checked),
                })
              }
            />
          ))}
        </>
      ) : null}

      <hr className="graph-panel__rule" />
      <SectionTitle>Propriétés</SectionTitle>
      {structuredDimensions.map((dimension) => {
        const find = (operator: StructuredGraphFilter["operator"]) =>
          state.structured.find(
            (filter) => filter.field === dimension.field && filter.operator === operator,
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
          <fieldset key={dimension.field} className="graph-panel__group">
            <legend className="ui-visually-hidden">{dimension.label}</legend>
            <PanelRow label={`${dimension.label} · après le`}>
              <input
                type="date"
                className="ui-native-input"
                data-size="compact"
                value={String(find("after")?.value ?? "")}
                onChange={(event) =>
                  onChange({ ...state, structured: replace("after", event.currentTarget.value) })
                }
              />
            </PanelRow>
            <PanelRow label={`${dimension.label} · avant le`}>
              <input
                type="date"
                className="ui-native-input"
                data-size="compact"
                value={String(find("before")?.value ?? "")}
                onChange={(event) =>
                  onChange({ ...state, structured: replace("before", event.currentTarget.value) })
                }
              />
            </PanelRow>
          </fieldset>
        ) : (
          <PanelRow key={dimension.field} label={dimension.label}>
            <NativeSelect
              density="compact"
              value={String(find("equals")?.value ?? "")}
              onChange={(event) =>
                onChange({ ...state, structured: replace("equals", event.currentTarget.value) })
              }
            >
              <option value="">Toutes les valeurs</option>
              {dimension.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </PanelRow>
        );
      })}
      <PanelRow label="Format de fichier">
        <NativeSelect
          density="compact"
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
        </NativeSelect>
      </PanelRow>

      <hr className="graph-panel__rule" />
      <SwitchRow
        label="Afficher les éléments isolés"
        help={GRAPH_HELP.isolated}
        checked={state.includeIsolated}
        onChange={(includeIsolated) => onChange({ ...state, includeIsolated })}
      />
      <SwitchRow
        label="Inclure la corbeille"
        help={GRAPH_HELP.trashed}
        checked={state.lifecycle === "including-trashed"}
        onChange={(checked) =>
          onChange({ ...state, lifecycle: checked ? "including-trashed" : "active" })
        }
      />

      <hr className="graph-panel__rule" />
      <button
        type="button"
        className="graph-panel__row graph-panel__row--action graph-panel__reset"
        onClick={() => onChange(resetGraphControlState(state))}
      >
        <span className="graph-panel__row-label">Réinitialiser les filtres</span>
      </button>
    </div>
  );
}
