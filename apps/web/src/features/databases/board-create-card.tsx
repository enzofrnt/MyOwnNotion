import type { DatabaseProperty, RelationTargets, Uuid } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import { type BoardCardDraft, BoardCardEditor } from "./board-card-editor.tsx";
import type { BoardInitialValues } from "./board-view.tsx";
import type { RelationOption } from "./value-editor.tsx";

export function BoardCreateCard({
  columnLabel,
  canCreateFolder,
  properties = [],
  initialValues = {},
  relationOptions = [],
  onCreate,
}: {
  readonly columnLabel: string;
  readonly canCreateFolder: boolean;
  readonly properties?: readonly DatabaseProperty[];
  readonly initialValues?: BoardInitialValues;
  readonly relationOptions?: readonly RelationOption[];
  readonly onCreate: (
    kind: "page" | "folder",
    title: string,
    values: BoardInitialValues,
    relations: RelationTargets,
  ) => Promise<void | Uuid>;
}) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = true) => {
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const save = async (draft: BoardCardDraft) => {
    await onCreate(
      draft.kind,
      draft.title,
      draft.values as BoardInitialValues,
      draft.relationTargets,
    );
  };
  return (
    <div className="database-board__create">
      {editing ? (
        <div className="database-card database-card--draft">
          <BoardCardEditor
            properties={properties}
            initial={{
              kind: "page",
              title: "",
              values: initialValues as BoardCardDraft["values"],
              relationTargets: {},
            }}
            relationOptions={relationOptions}
            canChooseKind={canCreateFolder}
            creating
            label={`Titre de la page dans ${columnLabel}`}
            onSave={save}
            onCancel={close}
          />
        </div>
      ) : (
        <Button
          ref={trigger}
          size="compact"
          variant="ghost"
          className="database-board__add"
          aria-label={`Nouvelle page dans ${columnLabel}`}
          onClick={() => setEditing(true)}
        >
          <AppIcon name="add" size="small" /> Nouvelle page
        </Button>
      )}
    </div>
  );
}
