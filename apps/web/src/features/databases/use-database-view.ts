import { type DatabaseDefinition, isUuid, type Uuid } from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface DatabaseViewContext {
  readonly activeViewId: Uuid;
  readonly selectedEntryId: Uuid | null;
  readonly scrollTop: number;
}

interface RequestedDatabaseView {
  readonly id: Uuid;
  observedActive: boolean;
}

const VIEW_CONTEXTS_KEY = "myOwnNotionDatabaseViewContexts";
const VIEW_CONTEXT_STORAGE_PREFIX = "myOwnNotion.databaseView";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextKey(databaseId: Uuid, viewId: Uuid): string {
  return `${databaseId}:${viewId}`;
}

export function readDatabaseViewContext(
  historyState: unknown,
  databaseId: Uuid,
  viewId: Uuid,
): DatabaseViewContext | null {
  if (!isRecord(historyState)) return null;
  const contexts = historyState[VIEW_CONTEXTS_KEY];
  if (!isRecord(contexts)) return null;
  const candidate = contexts[contextKey(databaseId, viewId)];
  if (!isRecord(candidate)) return null;
  const scrollTop = candidate["scrollTop"];
  const selectedEntryId = candidate["selectedEntryId"];
  if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop) || scrollTop < 0) return null;
  if (selectedEntryId !== null && !isUuid(selectedEntryId)) return null;
  return { activeViewId: viewId, selectedEntryId, scrollTop };
}

export function writeDatabaseViewContext(
  historyState: unknown,
  databaseId: Uuid,
  context: DatabaseViewContext,
): Record<string, unknown> {
  const state = isRecord(historyState) ? historyState : {};
  const storedContexts = isRecord(state[VIEW_CONTEXTS_KEY]) ? state[VIEW_CONTEXTS_KEY] : {};
  return {
    ...state,
    [VIEW_CONTEXTS_KEY]: {
      ...storedContexts,
      [contextKey(databaseId, context.activeViewId)]: context,
    },
  };
}

export function databaseViewIdFromSearch(
  definition: DatabaseDefinition,
  search: string,
): Uuid | null {
  const candidate = new URLSearchParams(search).get("view");
  return (
    definition.views.find(({ id, state }) => id === candidate && state === "active")?.id ?? null
  );
}

export function databaseSearchForView(search: string, viewId: Uuid): string {
  const params = new URLSearchParams(search);
  params.set("view", viewId);
  params.delete("entry");
  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

function sessionContextKey(databaseId: Uuid, viewId: Uuid): string {
  return `${VIEW_CONTEXT_STORAGE_PREFIX}.${databaseId}.${viewId}`;
}

function storedContext(databaseId: Uuid, viewId: Uuid): DatabaseViewContext | null {
  if (typeof window === "undefined") return null;
  try {
    const serialized = window.sessionStorage.getItem(sessionContextKey(databaseId, viewId));
    if (serialized !== null) {
      const parsed = JSON.parse(serialized) as unknown;
      const restored = readDatabaseViewContext(
        { [VIEW_CONTEXTS_KEY]: { [contextKey(databaseId, viewId)]: parsed } },
        databaseId,
        viewId,
      );
      if (restored !== null) return restored;
    }
  } catch {
    // A privacy mode can refuse session storage; history state is the fallback.
  }
  return readDatabaseViewContext(window.history.state, databaseId, viewId);
}

function persistContext(databaseId: Uuid, context: DatabaseViewContext): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      sessionContextKey(databaseId, context.activeViewId),
      JSON.stringify(context),
    );
  } catch {
    // The in-memory context remains valid for this mount.
  }
}

export function resolveActiveDatabaseViewId({
  activeViewIds,
  currentViewId,
  requestedViewId,
  urlViewId,
  firstActiveViewId,
  databaseChanged,
}: {
  readonly activeViewIds: readonly Uuid[];
  readonly currentViewId: Uuid;
  readonly requestedViewId: Uuid | null;
  readonly urlViewId: Uuid | null;
  readonly firstActiveViewId: Uuid;
  readonly databaseChanged: boolean;
}): Uuid {
  if (!databaseChanged && requestedViewId !== null && activeViewIds.includes(requestedViewId)) {
    return requestedViewId;
  }
  if (!databaseChanged && activeViewIds.includes(currentViewId)) return currentViewId;
  return urlViewId ?? firstActiveViewId;
}

export function useDatabaseView(definition: DatabaseDefinition) {
  const firstActive = definition.views.find(({ state }) => state === "active");
  if (firstActive === undefined) throw new Error("A database needs one active view");
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearch = searchParams.toString();
  const writeViewToUrl = useCallback(
    (viewId: Uuid): void => {
      const next = new URLSearchParams(databaseSearchForView(serializedSearch, viewId));
      setSearchParams(next, { replace: true, preventScrollReset: true });
    },
    [serializedSearch, setSearchParams],
  );
  const [context, setContext] = useState<DatabaseViewContext>(() => {
    const activeViewId = databaseViewIdFromSearch(definition, serializedSearch) ?? firstActive.id;
    return (
      storedContext(definition.databaseId, activeViewId) ?? {
        activeViewId,
        selectedEntryId: null,
        scrollTop: 0,
      }
    );
  });
  const contextRef = useRef(context);
  const databaseId = useRef(definition.databaseId);
  // Definition and entry refreshes can settle after a tab click. Remember the
  // explicit choice for as long as that view remains active so no stale effect
  // can restore the previously selected tab. A newly created view is allowed
  // one transient definition where its ID is not published yet.
  const requestedView = useRef<RequestedDatabaseView | null>(null);
  const triggers = useRef(new Map<Uuid, HTMLElement>());
  const activeViewIds = useMemo(
    () => definition.views.filter(({ state }) => state === "active").map(({ id }) => id),
    [definition.views],
  );

  useEffect(() => {
    const databaseChanged = databaseId.current !== definition.databaseId;
    databaseId.current = definition.databaseId;
    if (databaseChanged) requestedView.current = null;
    const urlView = databaseViewIdFromSearch(definition, serializedSearch);
    setContext((current) => {
      const currentIsActive = activeViewIds.includes(current.activeViewId);
      const requested = requestedView.current;
      const requestedIsActive = requested !== null && activeViewIds.includes(requested.id);
      if (
        !databaseChanged &&
        requested?.id === current.activeViewId &&
        !requested.observedActive &&
        !currentIsActive
      ) {
        return current;
      }
      if (requestedIsActive && requested !== null) requested.observedActive = true;
      else if (requested?.observedActive === true) requestedView.current = null;
      const activeViewId = resolveActiveDatabaseViewId({
        activeViewIds,
        currentViewId: current.activeViewId,
        requestedViewId: requestedIsActive && requested !== null ? requested.id : null,
        urlViewId: urlView,
        firstActiveViewId: firstActive.id,
        databaseChanged,
      });
      if (activeViewId === current.activeViewId && !databaseChanged) return current;
      const next =
        storedContext(definition.databaseId, activeViewId) ??
        ({ activeViewId, selectedEntryId: null, scrollTop: 0 } satisfies DatabaseViewContext);
      contextRef.current = next;
      persistContext(definition.databaseId, next);
      writeViewToUrl(activeViewId);
      return next;
    });
  }, [activeViewIds, definition, firstActive.id, serializedSearch, writeViewToUrl]);

  const updateContext = useCallback(
    (update: (current: DatabaseViewContext) => DatabaseViewContext): void => {
      const next = update(contextRef.current);
      contextRef.current = next;
      persistContext(definition.databaseId, next);
      setContext(next);
    },
    [definition.databaseId],
  );

  const selectView = useCallback(
    (activeViewId: Uuid): void => {
      requestedView.current = {
        id: activeViewId,
        observedActive: activeViewIds.includes(activeViewId),
      };
      writeViewToUrl(activeViewId);
      updateContext(
        () =>
          storedContext(definition.databaseId, activeViewId) ?? {
            activeViewId,
            selectedEntryId: null,
            scrollTop: 0,
          },
      );
    },
    [activeViewIds, definition.databaseId, updateContext, writeViewToUrl],
  );

  const rememberScroll = useCallback(
    (scrollTop: number): void => {
      updateContext((current) =>
        Math.abs(current.scrollTop - scrollTop) < 1 ? current : { ...current, scrollTop },
      );
    },
    [updateContext],
  );

  const rememberTrigger = useCallback((entryId: Uuid, element: HTMLElement | null): void => {
    if (element === null) triggers.current.delete(entryId);
    else triggers.current.set(entryId, element);
  }, []);

  const openEntry = useCallback(
    (entryId: Uuid): void => {
      updateContext((current) => ({ ...current, selectedEntryId: entryId }));
    },
    [updateContext],
  );

  const finishEntryReturn = useCallback((): void => {
    updateContext((current) => ({ ...current, selectedEntryId: null }));
  }, [updateContext]);

  const closeEntry = useCallback((): void => {
    const entryId = contextRef.current.selectedEntryId;
    finishEntryReturn();
    queueMicrotask(() => {
      const trigger = entryId === null ? null : triggers.current.get(entryId);
      trigger?.focus();
    });
  }, [finishEntryReturn]);

  return {
    context,
    selectView,
    rememberScroll,
    rememberTrigger,
    openEntry,
    finishEntryReturn,
    closeEntry,
  };
}
