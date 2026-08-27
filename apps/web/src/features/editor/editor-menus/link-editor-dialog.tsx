import type { ProjectedItem } from "@myownnotion/client-core";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  Field,
} from "../../../ui/primitives/index.ts";
import type { EditorInstance } from "../blocknote-schema.ts";
import {
  type EditorLinkDescriptor,
  openEditorLink,
  removeEditorLink,
  updateEditorLink,
} from "../editor-links.ts";

export function LinkEditorDialog({
  editor,
  items,
  link,
  onClose,
  onError,
  onOpenPage,
}: {
  readonly editor: EditorInstance;
  readonly items: readonly ProjectedItem[];
  readonly link: EditorLinkDescriptor | null;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onOpenPage?: ((itemId: string) => void) | undefined;
}) {
  const [text, setText] = useState(link?.text ?? "");
  const [target, setTarget] = useState(link?.target ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (item.kind === "page" || item.kind === "folder") &&
            (item.lifecycle === "active" || item.id === link?.target),
        )
        .toSorted((left, right) => left.name.localeCompare(right.name, "fr")),
    [items, link?.target],
  );

  useEffect(() => {
    setText(link?.text ?? "");
    setTarget(link?.target ?? "");
    setValidation(null);
  }, [link]);

  if (link === null) return null;

  const finish = (): void => {
    onClose();
    queueMicrotask(() => editor.focus());
  };

  const save = (): void => {
    if (!updateEditorLink(editor, link, { target, text })) {
      setValidation(
        link.kind === "page"
          ? "Choisissez une page et conservez un texte visible."
          : "Saisissez une adresse http, https ou mailto et un texte visible.",
      );
      return;
    }
    finish();
  };

  const remove = (): void => {
    if (!removeEditorLink(editor, link)) {
      onError("Ce lien a changé avant sa suppression. Réessayez depuis le texte.");
      return;
    }
    finish();
  };

  return (
    <DialogRoot open setOpen={(open) => !open && finish()}>
      <DialogContent className="editor-link-dialog" size="small" data-testid="link-editor-dialog">
        <DialogDismiss />
        <DialogHeading>Modifier le lien</DialogHeading>
        <DialogDescription>Le texte reste dans la page si vous retirez le lien.</DialogDescription>
        <Field
          autoFocus
          label="Texte affiché"
          value={text}
          error={validation ?? undefined}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setValidation(null);
          }}
        />
        {link.kind === "page" ? (
          <label className="editor-link-dialog__target">
            <span>Page cible</span>
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.currentTarget.value);
                setValidation(null);
              }}
            >
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Field
            label="Adresse"
            type="url"
            value={target}
            onChange={(event) => {
              setTarget(event.currentTarget.value);
              setValidation(null);
            }}
          />
        )}
        <div className="editor-link-dialog__actions">
          <Button variant="ghost" onClick={() => openEditorLink(link, onOpenPage)}>
            Ouvrir
          </Button>
          <Button variant="danger" onClick={remove} data-testid="remove-editor-link">
            Retirer le lien
          </Button>
          <Button variant="primary" onClick={save} data-testid="save-editor-link">
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
