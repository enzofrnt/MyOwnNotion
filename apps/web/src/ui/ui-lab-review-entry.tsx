import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { type EntryValues, previewDefinitionImpact } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { EntrySchemaImpact } from "../features/databases/edit-entry-properties.ts";
import { EntryPanel } from "../features/databases/entry-panel.tsx";
import { canonicalV3ToLegacyV2 } from "../features/editor/blocknote-conversion.ts";
import { PageEditor, type PageEditorHandle } from "../features/editor/page-editor.tsx";
import { FolderChildrenList } from "../features/workspace/folder-children-list.tsx";
import { PageTitleEditor } from "../features/workspace/page-title-editor.tsx";
import { PathBreadcrumbs } from "../features/workspace/path-breadcrumbs.tsx";
import { AppIcon } from "./icons.tsx";
import { Button } from "./primitives/button.tsx";
import { createReviewEditorSession } from "./ui-lab-review-editor-session.ts";
import { reviewDefinition, reviewId, reviewPage } from "./ui-lab-review-fixtures.ts";

const sampleEntry = (() => {
  const row = reviewPage.rows[0];
  if (row === undefined) throw new Error("Missing entry review fixture");
  return row;
})();

/** Canonical entry composition, with a memory-only document and property save. */
export function ReviewEntryPage() {
  const handleRef = useRef<PageEditorHandle | null>(null);
  const [kind, setKind] = useState<"page" | "folder">("page");
  const [available, setAvailable] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [fail, setFail] = useState(false);
  const [icon, setIcon] = useState<string | null>("💡");
  const [entry, setEntry] = useState<DatabaseEntryDto>(() => ({
    ...sampleEntry,
    databaseId: reviewId(11),
    lifecycle: "active",
    title: "Lancer la campagne de rentrée scolaire",
    document: null,
    values: {
      ...sampleEntry.values,
      [reviewId(8)]: { kind: "select", optionId: reviewId(24) },
    },
  }));
  const [session] = useState(() =>
    createReviewEditorSession({
      blocks: [
        {
          id: reviewId(100),
          type: "heading",
          level: 2,
          content: [{ text: "Décrivez votre idée" }],
        },
        {
          id: reviewId(101),
          type: "paragraph",
          content: [
            {
              text: "Préparer une campagne utile aux familles et aux équipes. Cette page conserve son contenu et les propriétés de sa base de données.",
            },
          ],
        },
        {
          id: reviewId(102),
          type: "heading",
          level: 2,
          content: [{ text: "Pourquoi pensez-vous que c’est important ?" }],
        },
        {
          id: reviewId(103),
          type: "bulletedListItem",
          content: [{ text: "Donner des informations claires dès la rentrée." }],
        },
      ],
    }),
  );
  const [editableDefinition, setEditableDefinition] = useState(reviewDefinition);
  const definition = empty
    ? {
        ...editableDefinition,
        properties: editableDefinition.properties.filter((p) => p.type === "title"),
      }
    : editableDefinition;
  return (
    <>
      <nav className="ui-lab__row" aria-label="États de l’entrée">
        <Button
          size="compact"
          variant="ghost"
          onClick={() => setKind(kind === "page" ? "folder" : "page")}
        >
          {kind === "page" ? "Afficher un dossier" : "Afficher une page"}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={!available}
          onClick={() => setAvailable(!available)}
        >
          Propriétés indisponibles
        </Button>
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={empty}
          onClick={() => setEmpty(!empty)}
        >
          Sans propriétés
        </Button>
        <Button size="compact" variant="ghost" aria-pressed={fail} onClick={() => setFail(!fail)}>
          Échec d’enregistrement
        </Button>
      </nav>
      <article className="workspace-page-canvas workspace-entry-canvas">
        <EntryPanel
          entry={entry}
          definition={definition}
          valuesAvailable={available}
          onClose={() => undefined}
          renderHeader={() => (
            <PageTitleEditor
              title={entry.title}
              icon={icon}
              kind={kind}
              onCommit={async (title) => setEntry((current) => ({ ...current, title }))}
              onIconChange={setIcon}
              breadcrumbs={
                <PathBreadcrumbs
                  path={[
                    { id: reviewId(11), name: "Campagnes", kind: "database" },
                    { id: entry.entryId, name: entry.title, kind },
                  ]}
                  onOpen={() => undefined}
                />
              }
              pathActions={
                <Button
                  size="compact"
                  variant="ghost"
                  className="workspace-page-title__graph"
                  aria-label="Voir les relations"
                  disabled
                >
                  <AppIcon name="graph" size="small" />
                  <span className="workspace-page-title__graph-label">Voir les relations</span>
                </Button>
              }
              onMoveToContent={() =>
                document.querySelector<HTMLElement>(".workspace-entry-canvas .ProseMirror")?.focus()
              }
            />
          )}
          relationOptions={[{ id: reviewId(31), label: "Préparer la prochaine version" }]}
          onEditDefinition={async (edit, confirmed = false) => {
            const next = edit(editableDefinition);
            const impact = await previewDefinitionImpact({
              current: editableDefinition,
              candidate: next,
              baseRevisionId: reviewId(50),
              entries: [
                {
                  format: "myownnotion.database-entry-values+json",
                  formatVersion: 1,
                  databaseId: definition.databaseId,
                  entryId: entry.entryId,
                  values: entry.values,
                  preserved: [],
                } as unknown as EntryValues,
              ],
            });
            if (impact.destructive && !confirmed) throw new EntrySchemaImpact(impact);
            setEditableDefinition(next);
            return next;
          }}
          onSaveValues={async (values, relationTargets) => {
            await new Promise((resolve) => setTimeout(resolve, 600));
            if (fail) throw new Error("Échec simulé dans l’exemple local.");
            setEntry((current) => ({
              ...current,
              values: { ...current.values, ...values } as DatabaseEntryDto["values"],
              relationTargets: {
                ...current.relationTargets,
                ...relationTargets,
              } as unknown as DatabaseEntryDto["relationTargets"],
            }));
          }}
          pageContent={
            kind === "folder" ? (
              <FolderChildrenList
                folderName={entry.title}
                items={[
                  {
                    id: reviewId(31),
                    name: "Préparer la prochaine version",
                    href: "#",
                    kind: "page",
                    childCount: 0,
                  },
                ]}
                onOpen={() => undefined}
                onReorder={() => undefined}
              />
            ) : (
              <div className="workspace-page-editor">
                <PageEditor
                  pageId={reviewId(42)}
                  handleRef={handleRef}
                  items={[]}
                  editable
                  session={session}
                  fileTransfersEnabled={false}
                  document={canonicalV3ToLegacyV2(session.read())}
                />
              </div>
            )
          }
        />
      </article>
    </>
  );
}
