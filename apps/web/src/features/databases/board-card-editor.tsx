import type {
  DatabaseProperty,
  NonRelationPropertyValue,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
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

export interface BoardCardEditorHandle {
  finish: () => Promise<boolean>;
}

/** Keep wrapping and text metrics identical to the resting title. */
function EditableCardTitle({
  value,
  label,
  readOnly,
  onInput,
  onFinish,
}: {
  readonly value: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly onInput: (value: string) => void;
  readonly onFinish: () => void;
}) {
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    // Native input owns the DOM while focused; projecting the same text must
    // not replace its selection on every autosave/render.
    if (node.textContent !== value) node.textContent = value;
  }, [value]);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an editable text node preserves the resting title's wrapping and geometry without an input frame.
    <span
      ref={element}
      className="database-card__name"
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-readonly={readOnly || undefined}
      data-placeholder="Écrivez un nom…"
      contentEditable={readOnly ? false : "plaintext-only"}
      suppressContentEditableWarning
      onInput={(event) => onInput(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key !== "Enter") return;
        event.preventDefault();
        onFinish();
      }}
    />
  );
}

/** Existing content autosaves; a new card stays atomic until Enter/outside. */
export function BoardCardEditor({
  properties,
  initial,
  relationOptions = [],
  canChooseKind = false,
  creating = false,
  expanded = true,
  cardProperties,
  titleIcon,
  columnId,
  onOpenEntry,
  ref,
  label,
  entryId,
  holdsContent,
  onConvert,
  onSave,
  onCancel,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly initial: BoardCardBaseline;
  readonly relationOptions?: readonly RelationOption[];
  readonly canChooseKind?: boolean;
  readonly creating?: boolean;
  readonly expanded?: boolean;
  readonly cardProperties?: readonly DatabaseProperty[];
  readonly titleIcon?: ReactNode;
  readonly columnId?: string;
  readonly onOpenEntry?: (trigger: HTMLElement) => void;
  readonly ref?: Ref<BoardCardEditorHandle> | undefined;
  readonly label: string;
  readonly entryId?: Uuid;
  readonly holdsContent?: boolean | undefined;
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
  const fields = useMemo(
    () => properties.filter((p) => p.state === "active" && p.type !== "title"),
    [properties],
  );
  const {
    title: initialTitle,
    kind: initialKind,
    values: initialValues,
    relationTargets: initialRelations,
  } = initial;
  const incoming = useMemo(
    () => ({
      title: initialTitle,
      kind: initialKind,
      values: initialValues,
      relationTargets: initialRelations,
    }),
    [initialTitle, initialKind, initialValues, initialRelations],
  );
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState(initial.kind);
  const [drafts, setDrafts] = useState<Record<string, ValueDraft>>(() =>
    Object.fromEntries(fields.map((p) => [p.id, entryValueDraft(p, initial)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const root = useRef<HTMLFieldSetElement>(null);
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
            const node = root.current?.querySelector<HTMLElement>('[role="textbox"]');
            if (node) {
              node.textContent = "";
              node.focus({ preventScroll: true });
            }
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
  useImperativeHandle(ref, () => ({ finish: () => flushRef.current() }), []);
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
    return () => {
      mounted.current = false;
      if (session.current.timer !== undefined) clearTimeout(session.current.timer);
      if (!creating) void flushRef.current();
    };
  }, [creating]);
  useEffect(() => {
    const s = session.current;
    if (creating || s.running || s.changed.size || s.titleChanged || s.blocked) return;
    s.baseline = incoming;
    s.title = incoming.title;
    s.kind = incoming.kind;
    s.drafts = Object.fromEntries(fields.map((p) => [p.id, entryValueDraft(p, incoming)]));
    setTitle(s.title);
    setKind(s.kind);
    setDrafts({ ...s.drafts });
  }, [incoming, fields, creating]);
  useEffect(() => {
    if (!expanded) return;
    // React capture follows the logical tree through portals. Document bubbling
    // distinguishes our picker/dialog events from genuine outside interaction.
    const outside = (event: Event) => {
      const editTrigger =
        !creating && event.target instanceof Element
          ? event.target.closest("[data-board-edit-trigger], [data-board-create-trigger]")
          : null;
      // Let the pencil's semantic click save and switch. Collapsing now moves
      // later cards out from under the pointer before its release can click.
      if (editTrigger && root.current?.closest(".database-board")?.contains(editTrigger)) return;
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
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [expanded, creating]);
  const visibleFields = (cardProperties ?? fields).filter((p) => {
    const value = drafts[p.id];
    return (
      p.type === "checkbox" ||
      (Array.isArray(value) ? value.length > 0 : value !== "" && value !== undefined)
    );
  });
  const wasExpanded = useRef(expanded);
  const pinnedVisible = useRef(visibleFields);
  if (!expanded || !wasExpanded.current) pinnedVisible.current = visibleFields;
  wasExpanded.current = expanded;
  const shownFields = expanded
    ? [
        ...pinnedVisible.current,
        ...fields.filter((p) => !pinnedVisible.current.some((visible) => visible.id === p.id)),
      ]
    : visibleFields;
  const icon =
    titleIcon === undefined ? (
      <AppIcon name={kind === "folder" ? "folder" : "file"} size="small" />
    ) : (
      titleIcon
    );
  return (
    <fieldset
      ref={root}
      className="database-card-editor"
      data-expanded={expanded || undefined}
      aria-label={label}
      aria-busy={pending}
      onPointerDownCapture={(e) => ownedEvents.current.add(e.nativeEvent)}
      onFocusCapture={(e) => ownedEvents.current.add(e.nativeEvent)}
      onKeyDown={(e) => {
        if (
          !expanded ||
          e.key !== "Escape" ||
          e.defaultPrevented ||
          !root.current?.contains(e.target as Node)
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (creating && session.current.running === null) latest.current.onCancel(true);
        else void closeRef.current(true);
      }}
    >
      {expanded ? (
        <div className="database-card-editor__title">
          <span className="database-card__identity">
            {icon}
            <EditableCardTitle
              label={label}
              value={title}
              readOnly={creating && pending}
              onInput={(v) => {
                setTitle(v);
                session.current.title = v;
                session.current.titleChanged = true;
                schedule();
              }}
              onFinish={() => {
                if (creating && session.current.running !== null) return;
                session.current.blocked = false;
                if (creating) void flushRef.current(true);
                else void closeRef.current(true);
              }}
            />
          </span>
        </div>
      ) : (
        <StableActionButton
          type="button"
          className="link database-card__title"
          variant="ghost"
          data-entry-trigger={entryId}
          data-entry-column={columnId}
          onActivate={(trigger) => onOpenEntry?.(trigger)}
        >
          <span className="database-card__identity">
            {icon}
            <span className="database-card__name">{title}</span>
          </span>
        </StableActionButton>
      )}
      <fieldset className="database-card-editor__fields" disabled={creating && pending}>
        {shownFields.map((p) => (
          <ValueEditor
            key={p.id}
            property={p}
            presentation="card"
            cardShowIcon={
              cardProperties === undefined ||
              !pinnedVisible.current.some((visible) => visible.id === p.id)
            }
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
      {expanded && canChooseKind ? (
        <div className="database-card-editor__kind">
          {entryId !== undefined && onConvert !== undefined ? (
            <ConvertItemControl
              itemId={entryId}
              itemName={title}
              kind={kind}
              holdsContent={holdsContent}
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
