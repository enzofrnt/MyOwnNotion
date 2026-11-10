import type { DatabaseProperty } from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";
import type { DatabaseViewRow } from "../../services/databases.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import {
  DialogContent,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
} from "../../ui/primitives/dialog.tsx";
import { evaluateFormula, type FormulaValue, formatFormulaValue } from "./formula.ts";

const FUNCTION_GROUPS: readonly {
  readonly title: string;
  readonly functions: readonly {
    readonly name: string;
    readonly label: string;
    readonly description: string;
  }[];
}[] = [
  {
    title: "Général",
    functions: [
      {
        name: "if",
        label: "if(condition, si vrai, sinon)",
        description: "Choisit une valeur selon une condition.",
      },
      {
        name: "and",
        label: "and(valeur, …)",
        description: "Vrai si toutes les valeurs sont vraies.",
      },
      { name: "or", label: "or(valeur, …)", description: "Vrai si une valeur est vraie." },
      { name: "not", label: "not(valeur)", description: "Inverse une valeur booléenne." },
      { name: "empty", label: "empty(valeur)", description: "Vrai si la valeur est vide." },
      { name: "equal", label: "equal(a, b)", description: "Compare deux valeurs." },
      {
        name: "unequal",
        label: "unequal(a, b)",
        description: "Vérifie que deux valeurs diffèrent.",
      },
      { name: "length", label: "length(texte)", description: "Nombre de caractères." },
      { name: "format", label: "format(valeur)", description: "Convertit une valeur en texte." },
    ],
  },
  {
    title: "Texte",
    functions: [
      { name: "concat", label: "concat(texte, …)", description: "Assemble des textes." },
      { name: "contains", label: "contains(texte, recherche)", description: "Cherche un texte." },
      {
        name: "substring",
        label: "substring(texte, début, fin)",
        description: "Extrait une partie du texte.",
      },
      {
        name: "replace",
        label: "replace(texte, avant, après)",
        description: "Remplace la première occurrence.",
      },
      {
        name: "replaceAll",
        label: "replaceAll(texte, avant, après)",
        description: "Remplace toutes les occurrences.",
      },
      { name: "lower", label: "lower(texte)", description: "Minuscules." },
      { name: "upper", label: "upper(texte)", description: "Majuscules." },
      { name: "trim", label: "trim(texte)", description: "Retire les espaces autour." },
      { name: "repeat", label: "repeat(texte, fois)", description: "Répète un texte." },
      {
        name: "padStart",
        label: "padStart(texte, longueur, remplissage)",
        description: "Complète au début.",
      },
      {
        name: "padEnd",
        label: "padEnd(texte, longueur, remplissage)",
        description: "Complète à la fin.",
      },
    ],
  },
  {
    title: "Numéro",
    functions: [
      { name: "round", label: "round(nombre, décimales)", description: "Arrondit un nombre." },
      { name: "abs", label: "abs(nombre)", description: "Valeur absolue." },
      { name: "ceil", label: "ceil(nombre)", description: "Arrondit au-dessus." },
      { name: "floor", label: "floor(nombre)", description: "Arrondit en dessous." },
      { name: "min", label: "min(nombre, …)", description: "Plus petite valeur." },
      { name: "max", label: "max(nombre, …)", description: "Plus grande valeur." },
      { name: "sum", label: "sum(nombre, …)", description: "Somme des valeurs." },
      { name: "number", label: "number(valeur)", description: "Convertit en nombre." },
    ],
  },
  {
    title: "Date",
    functions: [
      { name: "now", label: "now()", description: "Date et heure actuelles." },
      {
        name: "dateAdd",
        label: "dateAdd(date, nombre, unité)",
        description: "Ajoute des jours, semaines, mois…",
      },
      {
        name: "dateBetween",
        label: "dateBetween(début, fin, unité)",
        description: "Écart entre deux dates.",
      },
    ],
  },
];

function formulaType(value: FormulaValue): string {
  if (value === null) return "vide";
  if (typeof value === "boolean") return "booléen";
  if (typeof value === "number") return "nombre";
  return "texte";
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
  readonly property: Extract<DatabaseProperty, { type: "formula" }>;
  readonly properties: readonly DatabaseProperty[];
  readonly previewRow?: DatabaseViewRow | undefined;
  readonly previewRows?: readonly DatabaseViewRow[] | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSave: (expression: string) => void;
}) {
  const [draft, setDraft] = useState(property.config.expression);
  const [previewId, setPreviewId] = useState<string>("");
  useEffect(() => {
    if (open) setDraft(property.config.expression);
  }, [open, property.config.expression]);
  const selectedPreviewRow =
    (previewRows === undefined
      ? undefined
      : previewRows.find((row) => row.entryId === previewId)) ?? previewRow;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const preview =
    previewRow === undefined
      ? null
      : evaluateFormula(draft, {
          title: previewRow.title,
          properties,
          values: previewRow.values as never,
          relationTargets: previewRow.relationTargets as never,
          ...(previewRow.createdAt === undefined ? {} : { createdAt: previewRow.createdAt }),
          ...(previewRow.updatedAt === undefined ? {} : { updatedAt: previewRow.updatedAt }),
          revisionId: previewRow.revisionId,
          ...(previewRow.entryNumber === undefined ? {} : { entryNumber: previewRow.entryNumber }),
        });
  const insert = (text: string): void => {
    const element = textarea.current;
    if (element === null) {
      setDraft((current) => current + text);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + text.length;
      element.setSelectionRange(caret, caret);
    });
  };
  return (
    <DialogRoot open={open} setOpen={(value) => !value && onClose()}>
      <DialogContent className="formula-editor" size="large">
        <DialogDismiss />
        <DialogHeading>Modifier la formule</DialogHeading>
        <label className="formula-editor__field">
          <span className="sr-only">Formule</span>
          <textarea
            ref={textarea}
            className="formula-editor__input"
            aria-label="Formule"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="formula-editor__panels">
          <section className="formula-editor__panel" aria-label="Propriétés">
            <h3>Propriétés</h3>
            <div className="formula-editor__chips">
              {properties
                .filter((candidate) => candidate.state === "active")
                .map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className="formula-editor__chip"
                    onClick={() => insert(`prop(${JSON.stringify(candidate.name)})`)}
                  >
                    {candidate.name}
                  </button>
                ))}
            </div>
          </section>
          <section className="formula-editor__panel" aria-label="Fonctions">
            <h3>Fonctions</h3>
            <div className="formula-editor__function-groups">
              {FUNCTION_GROUPS.map((group) => (
                <section key={group.title} className="formula-editor__function-group">
                  <h4>{group.title}</h4>
                  <ul className="formula-editor__functions">
                    {group.functions.map((fn) => (
                      <li key={fn.name}>
                        <button
                          type="button"
                          className="formula-editor__function"
                          onClick={() => insert(`${fn.name}()`)}
                        >
                          <code>{fn.label}</code>
                          <span>{fn.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
        </div>
        <div className="formula-editor__preview" aria-live="polite">
          {previewRows !== undefined && previewRows.length > 0 ? (
            <label className="formula-editor__preview-picker">
              <span>Aperçu avec</span>
              <select
                value={selectedPreviewRow?.entryId ?? ""}
                onChange={(event) => setPreviewId(event.currentTarget.value)}
              >
                {previewRows.map((row) => (
                  <option key={row.entryId} value={row.entryId}>
                    {row.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {preview === null ? (
            <span className="muted">Prévisualisation indisponible.</span>
          ) : preview.ok ? (
            <>
              <span className="muted">Aperçu ({selectedPreviewRow?.title ?? "page"})</span>
              <strong>{formatFormulaValue(preview.value)}</strong>
              <span className="muted">Type : {formulaType(preview.value)}</span>
            </>
          ) : (
            <span className="database-field__error" role="alert">
              {preview.error}
            </span>
          )}
        </div>
        <div className="formula-editor__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(draft.trim());
              onClose();
            }}
            disabled={draft.trim() === ""}
          >
            <AppIcon name="check" size="small" />
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
