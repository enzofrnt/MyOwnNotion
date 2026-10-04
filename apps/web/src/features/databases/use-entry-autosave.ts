import type { DatabaseEntryDto } from "@myownnotion/contracts";
import {
  type DatabaseProperty,
  jsonValuesEqual,
  type NonRelationPropertyValue,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DATABASE_COPY } from "./database-copy.ts";
import { type ValueDraft, validateValueDraft } from "./value-editor.tsx";

export type EntryDrafts = Readonly<Record<string, ValueDraft>>;
export interface EntryValueChanges {
  readonly propertyIds: readonly Uuid[];
  readonly previousValues: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly previousRelations: RelationTargets;
}
export type SaveEntryValues = (
  values: Readonly<Record<Uuid, NonRelationPropertyValue>>,
  relations: RelationTargets,
  changes: EntryValueChanges,
) => void | Promise<void>;

export function entryValueDraft(property: DatabaseProperty, entry: DatabaseEntryDto): ValueDraft {
  if (property.type === "relation") return entry.relationTargets[property.id] ?? [];
  const value = entry.values[property.id];
  if (value === undefined)
    return property.type === "checkbox" ? false : property.type === "multi-select" ? [] : "";
  switch (value.kind) {
    case "text":
      return value.value;
    case "number":
      return value.decimal;
    case "date":
      return value.date;
    case "instant":
      return value.instant;
    case "status":
    case "select":
      return value.optionId;
    case "multi-select":
      return value.optionIds;
    case "checkbox":
      return value.checked;
  }
}

/** One serialized local write, followed by edits received while that write was pending. */
export function useEntryAutosave({
  entry,
  properties,
  available,
  initialDrafts,
  onDraftsChange,
  onSave,
}: {
  entry: DatabaseEntryDto;
  properties: readonly DatabaseProperty[];
  available: boolean;
  initialDrafts?: EntryDrafts | undefined;
  onDraftsChange?: ((drafts: EntryDrafts) => void) | undefined;
  onSave: SaveEntryValues;
}) {
  const projected = Object.fromEntries(properties.map((p) => [p.id, entryValueDraft(p, entry)]));
  const [drafts, setDrafts] = useState<EntryDrafts>({ ...projected, ...initialDrafts });
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const propertyTypes = useRef(new Map(properties.map((p) => [p.id, p.type])));
  const mounted = useRef(true);
  const session = useRef({
    entryId: entry.entryId,
    edited: { ...initialDrafts } as Record<string, ValueDraft>,
    pending: { ...initialDrafts } as Record<string, ValueDraft>,
    values: entry.values as unknown as Readonly<Record<Uuid, NonRelationPropertyValue>>,
    relations: entry.relationTargets as unknown as RelationTargets,
    busy: false,
    blocked: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const latest = useRef({ entry, properties, available, onSave, onDraftsChange });
  latest.current = { entry, properties, available, onSave, onDraftsChange };
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const flush = async (): Promise<void> => {
    const current = session.current;
    if (current.timer !== undefined) clearTimeout(current.timer);
    current.timer = undefined;
    if (current.busy || !latest.current.available || current.blocked) return;
    const pending = { ...current.pending };
    const values: Record<string, NonRelationPropertyValue> = {};
    const relations: Record<string, readonly Uuid[]> = {};
    const fieldErrors: Record<string, string> = {};
    const ids: Uuid[] = [];
    for (const property of latest.current.properties) {
      const input = pending[property.id];
      if (input === undefined) continue;
      const result = validateValueDraft(property, input);
      if (!result.ok) {
        fieldErrors[property.id] = result.error;
        continue;
      }
      ids.push(property.id);
      if (result.value !== undefined) values[property.id] = result.value;
      if (result.relationTargets !== undefined) relations[property.id] = result.relationTargets;
      delete current.pending[property.id];
    }
    if (mounted.current) setErrors(fieldErrors);
    if (ids.length === 0) return;
    const onSave = latest.current.onSave;
    const notifyDrafts = latest.current.onDraftsChange;
    const changes: EntryValueChanges = {
      propertyIds: ids,
      previousValues: current.values,
      previousRelations: current.relations,
    };
    current.busy = true;
    if (mounted.current) setState("saving");
    try {
      await onSave(
        values as Readonly<Record<Uuid, NonRelationPropertyValue>>,
        relations as RelationTargets,
        changes,
      );
      const nextValues = { ...current.values };
      const nextRelations = { ...current.relations };
      for (const id of ids) {
        delete nextValues[id];
        delete nextRelations[id];
        if (values[id] !== undefined) nextValues[id] = values[id];
        if (relations[id] !== undefined) nextRelations[id] = relations[id];
      }
      current.values = nextValues;
      current.relations = nextRelations;
      // Keep optimistic fields until their durable projection catches up. Only
      // unsaved fields need to survive a route remount.
      // A departed panel must not clear drafts edited after the same page was
      // reopened while its older write was still pending. A remount can replay
      // the retained draft safely (the persistence adapter accepts our echo).
      if (mounted.current && session.current === current) notifyDrafts?.({ ...current.pending });
      if (mounted.current && session.current === current) setState("saved");
    } catch (error) {
      if (mounted.current && session.current === current)
        setErrorMessage(error instanceof Error ? error.message : DATABASE_COPY.entry.saveFailed);
      for (const id of ids)
        if (current.pending[id] === undefined && pending[id] !== undefined)
          current.pending[id] = pending[id];
      current.blocked = true;
      if (mounted.current && session.current === current) notifyDrafts?.({ ...current.pending });
      if (mounted.current && session.current === current) setState("error");
    } finally {
      current.busy = false;
      if (
        session.current === current &&
        !current.blocked &&
        Object.keys(current.pending).some((id) => !(id in fieldErrors))
      )
        void flushRef.current();
    }
  };
  flushRef.current = flush;

  useLayoutEffect(() => {
    let current = session.current;
    if (current.entryId !== entry.entryId) {
      // The production panel is keyed by entry. This also isolates callers
      // that reuse it without a key.
      void flushRef.current();
      current = {
        entryId: entry.entryId,
        edited: { ...initialDrafts },
        pending: { ...initialDrafts },
        values: entry.values as unknown as Readonly<Record<Uuid, NonRelationPropertyValue>>,
        relations: entry.relationTargets as unknown as RelationTargets,
        busy: false,
        blocked: false,
        timer: undefined,
      };
      session.current = current;
      setState("idle");
      setErrors({});
    }
    for (const property of properties) {
      const id = property.id;
      if (propertyTypes.current.get(id) !== property.type) {
        delete current.edited[id];
        delete current.pending[id];
        propertyTypes.current.set(id, property.type);
      }
      const projectedValue = entryValueDraft(property, entry);
      if (current.pending[id] === undefined && !current.busy) {
        const edited = current.edited[id];
        if (
          jsonValuesEqual(
            Array.isArray(edited) ? [...edited].sort() : edited,
            Array.isArray(projectedValue) ? [...projectedValue].sort() : projectedValue,
          )
        )
          delete current.edited[id];
        // Do not regress a confirmed local value behind a delayed projection.
        if (current.edited[id] === undefined) {
          current.values = {
            ...current.values,
            ...(entry.values[id] === undefined ? {} : { [id]: entry.values[id] }),
          } as unknown as Readonly<Record<Uuid, NonRelationPropertyValue>>;
          if (entry.values[id] === undefined) {
            const next = { ...current.values };
            delete next[id];
            current.values = next;
          }
          current.relations = {
            ...current.relations,
            [id]: entry.relationTargets[id] ?? [],
          } as unknown as RelationTargets;
        }
      }
    }
    setDrafts({
      ...Object.fromEntries(properties.map((p) => [p.id, entryValueDraft(p, entry)])),
      ...current.edited,
    });
  }, [entry, properties, initialDrafts]);

  useEffect(() => {
    mounted.current = true;
    if (Object.keys(session.current.pending).length > 0)
      session.current.timer = setTimeout(() => void flushRef.current(), 350);
    return () => {
      mounted.current = false;
      void flushRef.current();
    };
  }, []);

  const update = (property: DatabaseProperty, input: ValueDraft): void => {
    const current = session.current;
    current.edited[property.id] = input;
    current.pending[property.id] = input;
    current.blocked = false;
    setDrafts((previous) => ({ ...previous, [property.id]: input }));
    setState("idle");
    setErrors((previous) => {
      const next = { ...previous };
      delete next[property.id];
      return next;
    });
    onDraftsChange?.({ ...current.pending });
    if (current.timer !== undefined) clearTimeout(current.timer);
    if (property.type === "text" || property.type === "number" || property.type === "date")
      current.timer = setTimeout(() => void flushRef.current(), 350);
    else void flushRef.current();
  };
  return {
    drafts,
    errors,
    state,
    error: state === "error" ? (errorMessage ?? DATABASE_COPY.entry.saveFailed) : null,
    useCurrentValues: () => {
      const current = session.current;
      current.pending = {};
      current.edited = {};
      current.blocked = false;
      setDrafts(Object.fromEntries(properties.map((p) => [p.id, entryValueDraft(p, entry)])));
      current.values = entry.values as unknown as Readonly<Record<Uuid, NonRelationPropertyValue>>;
      current.relations = entry.relationTargets as unknown as RelationTargets;
      setState("idle");
      setErrors({});
      onDraftsChange?.({});
    },
    update,
    flush: () => void flushRef.current(),
    retry: () => {
      session.current.blocked = false;
      void flushRef.current();
    },
  };
}
