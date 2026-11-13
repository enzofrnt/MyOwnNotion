import { ownedSourceIdFromItemId, type Uuid } from "@myownnotion/domain";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import type { RelationOption } from "./value-editor.tsx";

export interface RelationSourceOption {
  readonly id: Uuid;
  readonly ownerItemId: Uuid;
  readonly name: string;
  /** Property identities of this source, to find the source that owns one. */
  readonly propertyIds: readonly Uuid[];
  readonly definitionRevisionId?: Uuid | undefined;
}
interface RelationCatalog {
  readonly service: LocalContentService;
  readonly sources: readonly RelationSourceOption[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}
const CatalogContext = createContext<RelationCatalog | null>(null);

/** Shared by cells and entry overlays, including portals. No global mutable service. */
export function RelationCatalogProvider({
  service,
  children,
}: {
  readonly service: LocalContentService;
  readonly children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<RelationCatalog, "service" | "retry">>({
    sources: [],
    loading: true,
    error: null,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries discovery.
  useEffect(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    let disposed = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const rows = await service.listDatabases();
        const owners = new Map(
          (await service.getItems([...new Set(rows.map((row) => row.itemId))])).map((owner) => [
            owner.id,
            owner,
          ]),
        );
        const sources = rows.flatMap((row) => {
          const owner = owners.get(row.itemId);
          if (owner?.lifecycle !== "active" || owner.kind !== "database") return [];
          return [
            {
              id: row.sourceId ?? ownedSourceIdFromItemId(row.itemId),
              ownerItemId: row.itemId,
              name: row.definition.name?.trim() || owner.name || "Base sans nom",
              propertyIds: (row.definition.properties ?? []).map((property) => property.id),
              definitionRevisionId: row.definitionRevisionId,
            },
          ];
        });
        if (!disposed && current === generation) setState({ sources, loading: false, error: null });
      } catch {
        if (!disposed && current === generation)
          setState({
            sources: [],
            loading: false,
            error: "Les sources de données ne sont pas disponibles.",
          });
      }
    };
    void load();
    const unsubscribe = service.subscribeProjection(() => {
      void load();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [service, attempt]);
  return (
    <CatalogContext.Provider
      value={{ ...state, service, retry: () => setAttempt((value) => value + 1) }}
    >
      {children}
    </CatalogContext.Provider>
  );
}

export function useRelationCatalog() {
  return useContext(CatalogContext);
}

/** Load only the configured source's entries, never an inferred workspace-wide set. */
export function useRelationCandidates(sourceId: Uuid | undefined) {
  const catalog = useRelationCatalog();
  const service = catalog?.service;
  const source = catalog?.sources.find((candidate) => candidate.id === sourceId);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    readonly options: readonly RelationOption[];
    readonly loading: boolean;
    readonly error: string | null;
  }>({ options: [], loading: false, error: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the source read.
  useEffect(() => {
    if (sourceId === undefined || service === undefined || source === undefined) {
      setState({ options: [], loading: false, error: null });
      return;
    }
    let disposed = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      setState({ options: [], loading: true, error: null });
      try {
        const rows = (await service.listDatabaseEntries(source.ownerItemId)).filter(
          (row) => (row.sourceId ?? ownedSourceIdFromItemId(source.ownerItemId)) === sourceId,
        );
        const items = await service.getItems(rows.map((row) => row.entryItemId));
        const options = items
          .filter(
            (item) =>
              item.lifecycle === "active" && (item.kind === "page" || item.kind === "folder"),
          )
          .map((item) => ({ id: item.id, label: item.name || "Sans titre" }));
        if (!disposed && current === generation) setState({ options, loading: false, error: null });
      } catch {
        if (!disposed && current === generation)
          setState({
            options: [],
            loading: false,
            error: "Les pages de cette source ne sont pas disponibles localement.",
          });
      }
    };
    void load();
    const unsubscribe = service.subscribeProjection(() => {
      void load();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [service, sourceId, source, attempt]);
  return { ...state, source, catalog, retry: () => setAttempt((value) => value + 1) };
}
