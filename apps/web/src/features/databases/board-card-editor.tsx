import type {
  DatabaseProperty,
  NonRelationPropertyValue,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button, NativeInput } from "../../ui/primitives/index.ts";
import { ConvertItemControl, type ConvertOutcome } from "../navigation/convert-item.tsx";
import { entryValueDraft } from "./use-entry-autosave.ts";
import {
  type RelationOption,
  type ValueDraft,
  ValueEditor,
  validateValueDraft,
} from "./value-editor.tsx";

export interface BoardCardDraft {
  readonly kind: "page" | "folder";
  readonly title: string;
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly relationTargets: RelationTargets;
  readonly changedPropertyIds: readonly Uuid[];
}
export type BoardCardBaseline = Omit<BoardCardDraft, "changedPropertyIds">;

/** Existing content autosaves; a new card stays atomic until Enter/outside. */
export function BoardCardEditor({
  properties,
  initial,
  relationOptions = [],
  canChooseKind = false,
  creating = false,
  label,
  entryId,
  onConvert,
  onSave,
  onCancel,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly initial: BoardCardBaseline;
  readonly relationOptions?: readonly RelationOption[];
  readonly canChooseKind?: boolean;
  readonly creating?: boolean;
  readonly label: string;
  readonly entryId?: Uuid;
  readonly onConvert?: (
    id: Uuid,
    kind: "page" | "folder",
    confirmed: boolean,
  ) => Promise<ConvertOutcome>;
  readonly onSave: (
    draft: BoardCardDraft,
    continueCreating: boolean,
    previous: BoardCardBaseline,
  ) => Promise<void>;
  readonly onCancel: (restoreFocus?: boolean) => void;
}) {
  const id = useId();
  const fields = properties.filter((p) => p.state === "active" && p.type !== "title");
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState(initial.kind);
  const [drafts, setDrafts] = useState<Record<string, ValueDraft>>(() =>
    Object.fromEntries(fields.map((p) => [p.id, entryValueDraft(p, initial)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLFieldSetElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ownedEvents = useRef(new WeakSet<Event>());
  const mounted = useRef(true);
  const exiting = useRef(false);
  const session = useRef({
    baseline: initial,
    title: initial.title,
    kind: initial.kind,
    drafts: { ...drafts },
    changed: new Set<Uuid>(),
    titleChanged: false,
    blocked: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    running: null as Promise<boolean> | null,
  });
  const latest = useRef({ fields, onSave, onCancel });
  latest.current = { fields, onSave, onCancel };
  const flushRef = useRef<(next?: boolean) => Promise<boolean>>(async () => true);
  const flush = async (next = false): Promise<boolean> => {
    const s = session.current;
    if (s.timer !== undefined) clearTimeout(s.timer);
    s.timer = undefined;
    if (s.running !== null) {
      const ok = await s.running;
      return ok && !creating ? flushRef.current() : ok;
    }
    if (s.blocked) return false;
    if (!s.title.trim()) {
      if (!creating) {
        setError("Donnez un nom à cet élément. Votre saisie est conservée.");
        return false;
      }
      return true;
    }
    const values = { ...s.baseline.values };
    const relations = { ...s.baseline.relationTargets };
    const invalid: Record<string, string> = {};
    const changed = [...s.changed];
    for (const p of latest.current.fields) {
      if (!s.changed.has(p.id)) continue;
      const result = validateValueDraft(p, s.drafts[p.id] ?? entryValueDraft(p, s.baseline));
      if (!result.ok) {
        invalid[p.id] = result.error;
        continue;
      }
      delete values[p.id];
      delete relations[p.id];
      if (result.value !== undefined) values[p.id] = result.value;
      if (result.relationTargets !== undefined) relations[p.id] = result.relationTargets;
    }
    if (mounted.current) setErrors(invalid);
    if (Object.keys(invalid).length) return false;
    if (!creating && changed.length === 0 && !s.titleChanged) return true;
    const previous = s.baseline;
    const draft: BoardCardDraft = {
      kind: s.kind,
      title: s.title.trim(),
      values,
      relationTargets: relations,
      changedPropertyIds: changed,
    };
    s.changed.clear();
    s.titleChanged = false;
    if (mounted.current) {
      setPending(true);
      setError(null);
    }
    s.running = (async () => {
      try {
        await latest.current.onSave(draft, next, previous);
        s.baseline = draft;
        if (creating && next) {
          s.title = "";
          s.drafts = Object.fromEntries(
            latest.current.fields.map((p) => [p.id, entryValueDraft(p, initial)]),
          );
          s.baseline = initial;
          if (mounted.current) {
            setTitle("");
            setDrafts({ ...s.drafts });
            input.current?.focus({ preventScroll: true });
          }
        }
        return true;
      } catch (cause) {
        for (const p of changed) s.changed.add(p);
        if (draft.title !== previous.title) s.titleChanged = true;
        s.blocked = true;
        if (mounted.current)
          setError(
            `${cause instanceof Error ? cause.message : "L’enregistrement a échoué."} Votre saisie est conservée.`,
          );
        return false;
      } finally {
        s.running = null;
        if (mounted.current) setPending(false);
      }
    })();
    const ok = await s.running;
    if (ok && !creating && (s.changed.size || s.titleChanged)) return flushRef.current();
    return ok;
  };
  flushRef.current = flush;
  const schedule = (immediate = false) => {
    const s = session.current;
    s.blocked = false;
    if (s.timer !== undefined) clearTimeout(s.timer);
    if (!creating) s.timer = setTimeout(() => void flushRef.current(), immediate ? 0 : 350);
  };
  const closeRef = useRef<(restore: boolean) => Promise<void>>(async () => undefined);
  closeRef.current = async (restore) => {
    if (exiting.current) return;
    exiting.current = true;
    const ok = await flushRef.current();
    if (ok && mounted.current) latest.current.onCancel(restore);
    exiting.current = false;
  };
  useEffect(() => {
    mounted.current = true;
    input.current?.focus({ preventScroll: true });
    // React capture follows the logical tree through portals. Document bubbling
    // distinguishes our picker/dialog events from genuine outside interaction.
    const outside = (event: Event) => {
      if (
        !ownedEvents.current.has(event) &&
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      )
        void closeRef.current(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      mounted.current = false;
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      if (session.current.timer !== undefined) clearTimeout(session.current.timer);
      if (!creating) void flushRef.current();
    };
  }, [creating]);
  return (
    <fieldset
      ref={root}
      className="database-card-editor"
      aria-label={label}
      aria-busy={pending}
      onPointerDownCapture={(e) => ownedEvents.current.add(e.nativeEvent)}
      onFocusCapture={(e) => ownedEvents.current.add(e.nativeEvent)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented || !root.current?.contains(e.target as Node))
          return;
        e.preventDefault();
        e.stopPropagation();
        if (creating && session.current.running === null) latest.current.onCancel(true);
        else void closeRef.current(true);
      }}
    >
      <div className="database-card-editor__title">
        <AppIcon name={kind === "folder" ? "folder" : "file"} size="small" />
        <NativeInput
          ref={input}
          aria-label={label}
          placeholder="Écrivez un nom…"
          value={title}
          readOnly={creating && pending}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setTitle(v);
            session.current.title = v;
            session.current.titleChanged = true;
            schedule();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.key !== "Enter") return;
            e.preventDefault();
            if (creating && session.current.running !== null) return;
            session.current.blocked = false;
            if (creating) void flushRef.current(true);
            else void closeRef.current(true);
          }}
        />
      </div>
      <fieldset className="database-card-editor__fields" disabled={creating && pending}>
        {fields.map((p) => (
          <ValueEditor
            key={p.id}
            property={p}
            presentation="card"
            idSuffix={id}
            input={drafts[p.id] ?? entryValueDraft(p, initial)}
            error={errors[p.id] ?? null}
            relationOptions={relationOptions}
            onChange={(v) => {
              setDrafts((prev) => ({ ...prev, [p.id]: v }));
              session.current.drafts[p.id] = v;
              session.current.changed.add(p.id);
              schedule(p.type !== "text" && p.type !== "number" && p.type !== "date");
            }}
          />
        ))}
      </fieldset>
      {canChooseKind ? (
        <div className="database-card-editor__kind">
          {entryId !== undefined && onConvert !== undefined ? (
            <ConvertItemControl
              itemId={entryId}
              itemName={title}
              kind={kind}
              variant="switch"
              convert={async (entryId, target, confirmed) => {
                if (!(await flushRef.current()))
                  return {
                    ok: false,
                    needsConfirmation: false,
                    message: "Corrigez la saisie avant de convertir cet élément.",
                  };
                const result = await onConvert(entryId, target, confirmed);
                if (result.ok) {
                  setKind(target);
                  session.current.kind = target;
                }
                return result;
              }}
            />
          ) : (
            <fieldset className="database-card-kind" aria-label="Type d’élément">
              {(["page", "folder"] as const).map((k) => (
                <Button
                  key={k}
                  size="compact"
                  variant="ghost"
                  aria-pressed={kind === k}
                  disabled={creating && pending}
                  onClick={() => {
                    setKind(k);
                    session.current.kind = k;
                  }}
                >
                  <AppIcon name={k === "page" ? "file" : "folder"} size="small" />
                  {k === "page" ? "Page" : "Dossier"}
                </Button>
              ))}
            </fieldset>
          )}
        </div>
      ) : null}
      {error === null ? null : (
        <div className="database-card-editor__error">
          <p role="alert" className="database-board__create-error">
            {error}
          </p>
          <Button
            size="compact"
            variant="ghost"
            onClick={() => {
              session.current.blocked = false;
              if (creating) void closeRef.current(false);
              else void flushRef.current();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
    </fieldset>
  );
}
