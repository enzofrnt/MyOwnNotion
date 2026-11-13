import type { DatabaseProperty } from "@myownnotion/domain";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseViewRow } from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import {
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
} from "../../ui/primitives/dialog.tsx";
import { Switch } from "../../ui/primitives/switch.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import {
  checkFormulaSyntax,
  evaluateFormulaProperty,
  type FormulaResult,
  formatFormulaValue,
  formulaContextOf,
  formulaTypeLabel,
  formulaTypeOf,
} from "./formula.ts";
import {
  FORMULA_CATALOG,
  type FormulaCatalogEntry,
  type FormulaCatalogKind,
} from "./formula-catalog.ts";
import { DatabasePropertyIcon } from "./property-icon.tsx";

type FormulaProperty = Extract<DatabaseProperty, { type: "formula" }>;

interface Suggestion {
  readonly key: string;
  readonly group: string;
  readonly name: string;
  readonly insert: string;
  readonly description: string;
  readonly examples: readonly string[];
  readonly property?: DatabaseProperty;
  readonly kind?: FormulaCatalogKind;
}

const KIND_MARK: Readonly<Record<FormulaCatalogKind, string>> = {
  number: "#",
  text: "Aa",
  boolean: "☑",
  date: "◷",
  list: "≡",
  any: "ƒ",
};

const DEBUG_TYPE = { text: "txt", number: "num", boolean: "bool", date: "date", list: "list" };

/**
 * A draft that could not be saved (invalid when the editor closed) survives
 * until it is fixed or discarded, so closing never loses work and never
 * replaces the last valid expression.
 */
const unsavedDrafts = new Map<string, string>();

function propertyReference(name: string): string {
  return `prop(${JSON.stringify(name)})`;
}

function propertySuggestion(property: DatabaseProperty): Suggestion {
  const reference = propertyReference(property.name);
  const list = property.type === "multi-select" || property.type === "relation";
  return {
    key: `prop:${property.id}`,
    group: "Propriétés",
    name: property.name,
    insert: reference,
    description: `Propriété « ${property.name} », ${DATABASE_COPY.property.typeLabels[property.type]}.`,
    examples: list ? [reference, `${reference}.length()`] : [reference],
    property,
  };
}

function catalogSuggestion(group: string, entry: FormulaCatalogEntry): Suggestion {
  return {
    key: entry.key,
    group,
    name: entry.name,
    insert: entry.insert,
    description: entry.description,
    examples: entry.examples,
    kind: entry.kind,
  };
}

/** The identifier being typed just before the caret, if any. */
function wordBefore(
  text: string,
  caret: number,
): { readonly start: number; readonly word: string } {
  const match = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(text.slice(0, caret));
  return match === null
    ? { start: caret, word: "" }
    : { start: caret - match[0].length, word: match[0] };
}

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

export function FormulaEditor({
  property,
  properties,
  previewRow,
  previewRows,
  open,
  onClose,
  onSave,
}: {
  readonly property: FormulaProperty;
  readonly properties: readonly DatabaseProperty[];
  readonly previewRow?: DatabaseViewRow | undefined;
  readonly previewRows?: readonly DatabaseViewRow[] | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSave: (expression: string) => void;
}) {
  const saved = property.config.expression;
  const [draft, setDraft] = useState(saved);
  const [caret, setCaret] = useState(saved.length);
  const [previewId, setPreviewId] = useState("");
  const [debug, setDebug] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Reopening restores an unsaved draft; otherwise the saved expression.
  useEffect(() => {
    if (!open) return;
    const initial = unsavedDrafts.get(property.id) ?? saved;
    setDraft(initial);
    setCaret(initial.length);
    setActiveKey(null);
  }, [open, property.id, saved]);

  const rows = previewRows ?? (previewRow === undefined ? [] : [previewRow]);
  const selectedRow = rows.find((row) => row.entryId === previewId) ?? previewRow ?? rows[0];

  const syntax = useMemo(() => checkFormulaSyntax(draft), [draft]);
  // The preview is always computed for the entry named next to it.
  const preview = useMemo<FormulaResult | null>(() => {
    if (draft.trim() === "") return null;
    if (!syntax.ok) return syntax;
    if (selectedRow === undefined) return null;
    return evaluateFormulaProperty(
      { ...property, config: { expression: draft } },
      formulaContextOf(selectedRow, properties),
    );
  }, [draft, syntax, selectedRow, property, properties]);

  const suggestions = useMemo<readonly Suggestion[]>(() => {
    const all: Suggestion[] = [
      ...properties
        .filter((candidate) => candidate.state === "active" && candidate.id !== property.id)
        .map(propertySuggestion),
      ...FORMULA_CATALOG.flatMap((group) =>
        group.entries.map((entry) => catalogSuggestion(group.title, entry)),
      ),
    ];
    const { word } = wordBefore(draft, caret);
    if (word === "") return all;
    const needle = normalized(word);
    const matches = all.filter((suggestion) => normalized(suggestion.name).includes(needle));
    const rank = (suggestion: Suggestion): number =>
      normalized(suggestion.name).startsWith(needle) ? 0 : 1;
    return [...matches].sort((left, right) => rank(left) - rank(right));
  }, [properties, property.id, draft, caret]);
  const typing = wordBefore(draft, caret).word !== "";
  const active = suggestions.find(({ key }) => key === activeKey) ?? suggestions[0];

  useEffect(() => {
    if (active === undefined) return;
    const items = list.current?.querySelectorAll<HTMLElement>("[data-suggestion]") ?? [];
    for (const item of items) {
      if (item.getAttribute("data-suggestion") === active.key)
        item.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  const insert = (text: string, replaceWord: boolean): void => {
    const element = textarea.current;
    const end = element?.selectionEnd ?? caret;
    const start = replaceWord ? wordBefore(draft, end).start : (element?.selectionStart ?? caret);
    const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`;
    // A function call leaves the caret between its parentheses.
    const position = start + (text.endsWith("()") ? text.length - 1 : text.length);
    setDraft(next);
    setCaret(position);
    setActiveKey(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  const move = (offset: number): void => {
    if (suggestions.length === 0) return;
    const index = active === undefined ? -1 : suggestions.indexOf(active);
    const next = suggestions[(index + offset + suggestions.length) % suggestions.length];
    if (next !== undefined) setActiveKey(next.key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "ArrowDown" && (typing || event.altKey)) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" && (typing || event.altKey)) {
      event.preventDefault();
      move(-1);
    } else if ((event.key === "Enter" || event.key === "Tab") && typing && active !== undefined) {
      if (event.shiftKey) return;
      event.preventDefault();
      insert(active.insert, true);
    }
  };

  const dirty = draft !== saved;
  const close = (): void => {
    const next = draft.trim();
    if (next === saved.trim()) unsavedDrafts.delete(property.id);
    else if (next !== "" && syntax.ok) {
      unsavedDrafts.delete(property.id);
      onSave(next);
    } else {
      // Invalid or empty: the saved formula stays, the draft is kept for later.
      unsavedDrafts.set(property.id, draft);
    }
    onClose();
  };
  const discard = (): void => {
    unsavedDrafts.delete(property.id);
    setDraft(saved);
    setCaret(saved.length);
    textarea.current?.focus();
  };

  const fault =
    preview !== null && !preview.ok && preview.start !== undefined
      ? { start: preview.start, end: Math.max(preview.end ?? preview.start, preview.start + 1) }
      : null;
  const groups = useMemo(() => {
    const result: { title: string; items: Suggestion[] }[] = [];
    for (const suggestion of suggestions) {
      const title = typing ? "Résultats" : suggestion.group;
      const last = result.at(-1);
      if (last !== undefined && last.title === title) last.items.push(suggestion);
      else result.push({ title, items: [suggestion] });
    }
    return result;
  }, [suggestions, typing]);

  return (
    <DialogRoot open={open} setOpen={(value) => !value && close()}>
      <DialogContent className="formula-editor" size="large" aria-label="Modifier la formule">
        <header className="formula-editor__header">
          <DialogHeading>Modifier la formule</DialogHeading>
          {dirty ? (
            <Button type="button" variant="ghost" size="compact" onClick={discard}>
              Annuler toutes les modifications
            </Button>
          ) : null}
          <DialogDismiss />
        </header>
        <div className="formula-editor__field" data-invalid={fault !== null || undefined}>
          <pre className="formula-editor__mirror" aria-hidden="true">
            {fault === null ? (
              draft
            ) : (
              <>
                {draft.slice(0, fault.start)}
                <span className="formula-editor__fault">
                  {draft.slice(fault.start, fault.end) || " "}
                </span>
                {draft.slice(fault.end)}
              </>
            )}
            {"\n"}
          </pre>
          <textarea
            ref={textarea}
            className="formula-editor__input"
            aria-label="Formule"
            aria-invalid={preview !== null && !preview.ok}
            aria-describedby="formula-editor-result"
            placeholder="Votre formule"
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => {
              setDraft(event.target.value);
              setCaret(event.target.selectionEnd);
              setActiveKey(null);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionEnd)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="formula-editor__preview">
          <div className="formula-editor__preview-controls">
            {rows.length > 0 ? (
              <label className="formula-editor__preview-picker">
                <span>Prévisualiser avec</span>
                <select
                  value={selectedRow?.entryId ?? ""}
                  onChange={(event) => setPreviewId(event.currentTarget.value)}
                >
                  {rows.map((row) => (
                    <option key={row.entryId} value={row.entryId}>
                      {row.title === "" ? "Sans titre" : row.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="muted">Aucune entrée pour prévisualiser.</span>
            )}
            <div className="formula-editor__debug">
              <Switch
                checked={debug}
                onCheckedChange={setDebug}
                aria-labelledby="formula-editor-debug-label"
              />
              <span id="formula-editor-debug-label">Mode débogage</span>
            </div>
          </div>
          <div className="formula-editor__result" id="formula-editor-result" aria-live="polite">
            {preview === null ? (
              <>
                <span className="muted">Aucune sortie</span>
                <span className="formula-editor__type">Type : inconnu</span>
              </>
            ) : preview.ok ? (
              <>
                <span className="formula-editor__value">
                  <strong>{formatFormulaValue(preview.value)}</strong>
                  {debug && preview.value !== null ? (
                    <span className="formula-editor__debug-type">
                      {DEBUG_TYPE[formulaTypeOf(preview.value) as keyof typeof DEBUG_TYPE]}
                    </span>
                  ) : null}
                </span>
                <span className="formula-editor__type">
                  Type : {formulaTypeLabel(preview.value)}
                </span>
              </>
            ) : (
              <span className="formula-editor__error" role="alert">
                {preview.error}
                {preview.start === undefined
                  ? ""
                  : ` [${preview.start},${preview.end ?? preview.start}]`}
                {dirty && saved.trim() !== "" ? " — la formule enregistrée reste inchangée." : ""}
              </span>
            )}
          </div>
        </div>
        <div className="formula-editor__reference">
          <div
            ref={list}
            className="formula-editor__list"
            role="listbox"
            aria-label="Propriétés et fonctions"
          >
            {groups.length === 0 ? (
              <p className="muted formula-editor__empty">Aucun résultat.</p>
            ) : (
              groups.map((group) => (
                <section key={group.title}>
                  <h3>{group.title}</h3>
                  {group.items.map((suggestion) => (
                    <button
                      key={suggestion.key}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={suggestion.key === active?.key}
                      data-suggestion={suggestion.key}
                      className="formula-editor__item"
                      onMouseEnter={() => setActiveKey(suggestion.key)}
                      onFocus={() => setActiveKey(suggestion.key)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insert(suggestion.insert, typing)}
                    >
                      <span className="formula-editor__item-mark" aria-hidden="true">
                        {suggestion.property === undefined ? (
                          KIND_MARK[suggestion.kind ?? "any"]
                        ) : (
                          <DatabasePropertyIcon type={suggestion.property.type} />
                        )}
                      </span>
                      <span className="formula-editor__item-name">{suggestion.name}</span>
                      {suggestion.key === active?.key ? (
                        <span className="formula-editor__item-hint" aria-hidden="true">
                          ↵
                        </span>
                      ) : null}
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
          <section className="formula-editor__doc" aria-label="Documentation">
            {active === undefined ? null : (
              <>
                <h3>
                  <span className="formula-editor__item-mark" aria-hidden="true">
                    {active.property === undefined ? (
                      KIND_MARK[active.kind ?? "any"]
                    ) : (
                      <DatabasePropertyIcon type={active.property.type} />
                    )}
                  </span>
                  {active.name}
                </h3>
                <p>{active.description}</p>
                <ul>
                  {active.examples.map((example) => (
                    <li key={example}>
                      <code>{example}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        aria-label={`Insérer l’exemple ${example}`}
                        title="Insérer cet exemple"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insert(example, false)}
                      >
                        <AppIcon name="copy" size="small" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
