import type { ProjectedItem } from "@myownnotion/client-core";
import type { DatabaseEntryDto } from "@myownnotion/contracts";
import type { DatabaseView, NonRelationPropertyValue, Uuid } from "@myownnotion/domain";
import { useRef, useState } from "react";
import { BoardView } from "../features/databases/board-view.tsx";
import { CalendarView } from "../features/databases/calendar-view.tsx";
import { StructuredConflictCard } from "../features/databases/database-conflict-resolution.tsx";
import { EntryPanel } from "../features/databases/entry-panel.tsx";
import { FilterEditor } from "../features/databases/filter-editor.tsx";
import { GalleryView } from "../features/databases/gallery-view.tsx";
import { ListView } from "../features/databases/list-view.tsx";
import {
  type DatabasePropertyDraft,
  PropertyEditor,
} from "../features/databases/property-editor.tsx";
import { SortGroupEditor } from "../features/databases/sort-group-editor.tsx";
import { type DatabaseCellUpdate, TableView } from "../features/databases/table-view.tsx";
import { type ValueDraft, ValueEditor } from "../features/databases/value-editor.tsx";
import { canonicalV3ToLegacyV2 } from "../features/editor/blocknote-conversion.ts";
import { PageEditor, type PageEditorHandle } from "../features/editor/page-editor.tsx";
import { type FilePreviewLoad, FilePreviewSurface } from "../features/files/file-preview.tsx";
import { TransferStateIndicator } from "../features/files/transfer-state.tsx";
import { RevisionRestore } from "../features/history/revision-restore.tsx";
import { ConflictResolution } from "../features/sync/conflict-resolution.tsx";
import { PageAmbiguityNotice } from "../features/sync/page-ambiguity-notice.tsx";
import type { DatabaseViewPage } from "../services/databases.ts";
import {
  Button,
  DrawerContent,
  DrawerHeading,
  DrawerRoot,
  LinkButton,
} from "./primitives/index.ts";
import { ReviewAttachments } from "./ui-lab-review-attachments.tsx";
import { createReviewEditorSession } from "./ui-lab-review-editor-session.ts";
import {
  reviewAmbiguity,
  reviewConflictService,
  reviewDefinition,
  reviewDocument,
  reviewId,
  reviewPage,
  reviewProperties,
  reviewStructuredConflict,
  reviewTable,
} from "./ui-lab-review-fixtures.ts";
import { ReviewStates } from "./ui-lab-review-states.tsx";

import { ReviewBackup, ReviewDesktop, ReviewRecovery } from "./ui-lab-review-system.tsx";

const surfaces = [
  "conflicts",
  "files",
  "history",
  "database",
  "properties",
  "editor",
  "recovery",
  "desktop",
  "backup",
  "states",
] as const;
const surfaceLabels = {
  conflicts: "Conflits",
  files: "Fichiers",
  history: "Historique",
  database: "Bases de données",
  properties: "Propriétés",
  editor: "Éditeur",
  recovery: "Récupération",
  desktop: "Client desktop",
  backup: "Sauvegardes",
  states: "États de l’app",
};
const formatLabels = {
  table: "Table",
  board: "Tableau kanban",
  gallery: "Galerie",
  list: "Liste",
  calendar: "Calendrier",
};
export type ReviewSurface = (typeof surfaces)[number];
export function isReviewSurface(value: string | null): value is ReviewSurface {
  return surfaces.some((surface) => surface === value);
}

function PreviewFiles() {
  const [kind, setKind] = useState<"loading" | "ready" | "failed" | "unsupported">("loading");
  const [remote, setRemote] = useState(false);
  const load: FilePreviewLoad =
    kind === "ready"
      ? {
          kind,
          url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='400'%3E%3Crect width='720' height='400' fill='%23242424'/%3E%3Ccircle cx='360' cy='200' r='80' fill='%234481d8'/%3E%3C/svg%3E",
        }
      : kind === "failed"
        ? { kind, reason: "L’aperçu n’a pas pu être chargé. Le fichier reste conservé." }
        : { kind: "loading" };
  return (
    <>
      <div className="ui-lab__row">
        {(["loading", "ready", "failed", "unsupported"] as const).map((state) => (
          <Button
            key={state}
            size="compact"
            variant="ghost"
            aria-pressed={state === kind}
            onClick={() => setKind(state)}
          >
            {state === "loading"
              ? "Chargement"
              : state === "ready"
                ? "Aperçu"
                : state === "failed"
                  ? "Erreur"
                  : "Format non pris en charge"}
          </Button>
        ))}
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={remote}
          onClick={() => setRemote(!remote)}
        >
          Fichier distant
        </Button>
      </div>
      <FilePreviewSurface
        fileItemId={reviewId(60)}
        fileName="Un fichier avec un nom particulièrement long pour conserver une lecture confortable.svg"
        mediaType={kind === "unsupported" ? "application/octet-stream" : "image/svg+xml"}
        byteLength={4096}
        availability={remote ? "offloaded" : "present"}
        load={load}
      />
      <TransferStateIndicator state={{ kind: "uploading", sent: 512, total: 4096 }} />
      <TransferStateIndicator state={{ kind: "verifying" }} />
      <TransferStateIndicator state={{ kind: "blocked", reason: "quota", limitBytes: 4096 }} />
      <TransferStateIndicator state={{ kind: "synchronized", itemId: reviewId(60) }} />
      <ReviewAttachments />
    </>
  );
}

function wireValue(value: NonRelationPropertyValue): DatabaseEntryDto["values"][string] {
  return value.kind === "multi-select" ? { ...value, optionIds: [...value.optionIds] } : value;
}

function PreviewDatabases() {
  const query = new URLSearchParams(location.search);
  const format = query.get("format") ?? "table";
  const initial: DatabaseView =
    format === "board"
      ? {
          ...reviewTable,
          type: "board",
          options: { axisPropertyId: reviewId(2), columnOrder: [], collapsedColumnIds: [] },
        }
      : format === "gallery"
        ? {
            ...reviewTable,
            type: "gallery",
            options: { preview: "page", cardPropertyIds: [reviewId(2), reviewId(7)] },
          }
        : format === "calendar"
          ? {
              ...reviewTable,
              type: "calendar",
              options: { datePropertyId: reviewId(3), initialMode: "month" },
            }
          : format === "list"
            ? {
                ...reviewTable,
                type: "list",
                options: {
                  density: "comfortable",
                  secondaryPropertyIds: [reviewId(2), reviewId(3)],
                },
              }
            : reviewTable;
  const [view, setView] = useState(initial);
  const [empty, setEmpty] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [data, setData] = useState<DatabaseViewPage>(reviewPage);
  const page = empty ? { ...data, rows: [], availableCount: 0, expectedCount: 0 } : data;
  const selected = page.rows.find((row) => row.entryId === opened);
  const update = (entryId: Uuid, change: DatabaseCellUpdate) =>
    setData((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.entryId !== entryId
          ? row
          : change.kind === "title"
            ? { ...row, title: change.title }
            : {
                ...row,
                values: {
                  ...row.values,
                  ...(change.value === undefined
                    ? {}
                    : { [change.propertyId]: wireValue(change.value) }),
                },
                relationTargets: {
                  ...row.relationTargets,
                  ...(change.relationTargets === undefined
                    ? {}
                    : { [change.propertyId]: [...change.relationTargets] }),
                },
              },
      ),
    }));
  const props = {
    properties: reviewProperties,
    page,
    onOpenEntry: (id: string) => setOpened(id),
    onUpdateEntry: update,
  };
  return (
    <>
      <nav className="ui-lab__row" aria-label="Formats de revue">
        {(["table", "board", "gallery", "list", "calendar"] as const).map((type) => (
          <LinkButton
            size="compact"
            variant="ghost"
            key={type}
            href={`?review=database&format=${type}`}
          >
            {formatLabels[type]}
          </LinkButton>
        ))}
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={empty}
          onClick={() => setEmpty(!empty)}
        >
          {empty ? "Remplir" : "Vider"}
        </Button>
      </nav>
      {view.type === "table" ? (
        <TableView {...props} view={view} onResize={() => undefined} />
      ) : view.type === "board" ? (
        <BoardView {...props} view={view} onChangeView={setView} />
      ) : view.type === "gallery" ? (
        <GalleryView
          {...props}
          view={view}
          onChangeView={setView}
          previews={
            new Map([
              [
                reviewId(30),
                {
                  kind: "page",
                  text: "Une page conserve son contenu, ses propriétés et ses liens.",
                },
              ],
            ])
          }
        />
      ) : view.type === "list" ? (
        <ListView {...props} view={view} />
      ) : (
        <CalendarView
          {...props}
          view={view}
          onChangeView={setView}
          referenceDate={new Date("2026-10-03T12:00:00Z")}
        />
      )}
      {selected === undefined ? null : (
        <DrawerRoot
          open
          setOpen={(open) => {
            if (!open) setOpened(null);
          }}
        >
          <DrawerContent side="right">
            <DrawerHeading>Propriétés de la page</DrawerHeading>
            <EntryPanel
              definition={reviewDefinition}
              entry={{ ...selected, databaseId: reviewId(11), lifecycle: "active", document: null }}
              onClose={() => setOpened(null)}
              onSaveValues={async (values, relationTargets) =>
                setData((current) => ({
                  ...current,
                  rows: current.rows.map((row) =>
                    row.entryId === selected.entryId
                      ? {
                          ...row,
                          values: Object.fromEntries(
                            Object.entries(values).map(([id, value]) => [id, wireValue(value)]),
                          ),
                          relationTargets: Object.fromEntries(
                            Object.entries(relationTargets).map(([id, targets]) => [
                              id,
                              [...targets],
                            ]),
                          ),
                        }
                      : row,
                  ),
                }))
              }
            />
          </DrawerContent>
        </DrawerRoot>
      )}
      <FilterEditor properties={reviewProperties} view={view} onChange={setView} />
      <SortGroupEditor properties={reviewProperties} view={view} onChange={setView} />
    </>
  );
}

function PreviewProperties() {
  const [draft, setDraft] = useState<DatabasePropertyDraft>({
    name: "Catégories",
    type: "multi-select",
    options: [{ key: "a", label: "Une option particulièrement longue", tone: "purple" }],
  });
  const [values, setValues] = useState<Record<string, ValueDraft>>({});
  return (
    <>
      <PropertyEditor
        draft={draft}
        error={null}
        onChange={setDraft}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
      {reviewProperties
        .filter((p) => p.type !== "title")
        .map((property) => (
          <ValueEditor
            key={property.id}
            property={property}
            input={
              values[property.id] ??
              (property.type === "checkbox"
                ? false
                : property.type === "multi-select" || property.type === "relation"
                  ? []
                  : "")
            }
            error={null}
            relationOptions={[{ id: reviewId(31), label: "Un dossier lié à cette entrée" }]}
            onChange={(input) => setValues((current) => ({ ...current, [property.id]: input }))}
          />
        ))}
    </>
  );
}

function PreviewHistory() {
  const item = { id: reviewId(42), currentRevisionId: reviewId(43) } as ProjectedItem;
  return (
    <div className="settings-content">
      <RevisionRestore
        item={item}
        api={{
          getRevision: async (id) =>
            ({
              ok: true,
              value: {
                id,
                parentRevisionIds: [reviewId(43)],
                acceptedAt: "2026-10-03T10:00:00Z",
                authoredByDeviceName: "Ordinateur de référence",
                snapshotRetained: true,
                snapshot: {
                  pageDocument: reviewDocument(
                    "Un contenu conservé avec une référence très longue : https://exemple.local/une-reference-qui-ne-doit-jamais-faire-deborder-la-page",
                  ),
                },
              },
            }) as never,
          getItem: async () => ({ ok: true, value: { currentRevisionId: reviewId(43) } }) as never,
          restoreRevision: async () => ({ ok: false, problem: { code: "example.local" } }) as never,
        }}
      />
      <p className="ui-lab__hint">
        Identifiant d’exemple : {reviewId(45)}. Aucune restauration serveur.
      </p>
    </div>
  );
}

function PreviewEditor() {
  const handleRef = useRef<PageEditorHandle | null>(null);
  const [session] = useState(() =>
    createReviewEditorSession({
      blocks: [
        {
          id: reviewId(70),
          type: "heading",
          level: 1,
          content: [{ text: "Une page de référence" }],
        },
        ...reviewDocument(
          "Sélectionnez du texte pour mettre en forme. Tapez / pour voir les commandes. Toutes les modifications restent ici.",
        ).blocks,
        {
          id: reviewId(71),
          type: "checkbox",
          checked: false,
          content: [{ text: "Une tâche intégrée au document" }],
        },
        {
          id: reviewId(72),
          type: "quote",
          content: [
            {
              text: "Une citation avec un texte suffisamment long pour vérifier la colonne de lecture à toutes les largeurs.",
            },
          ],
        },
        {
          id: reviewId(73),
          type: "code",
          language: "typescript",
          text: "const interfaceCalme = { contenu: 'prioritaire', actions: 'prévisibles' };",
        },
        {
          id: reviewId(74),
          type: "callout",
          content: [
            {
              text: "Un encadré de contenu conserve sa couleur, sans devenir un message système.",
            },
          ],
          icon: "💡",
          tone: "blue",
        },
        {
          id: reviewId(75),
          type: "toggle",
          content: [{ text: "Une section repliable" }],
          children: [
            {
              id: reviewId(76),
              type: "paragraph",
              content: [{ text: "Un détail dans le document." }],
            },
          ],
        },
        {
          id: reviewId(77),
          type: "table",
          columns: [
            { id: reviewId(78), width: 240 },
            { id: reviewId(79), width: 240 },
          ],
          rows: [
            {
              id: reviewId(80),
              cells: [
                { id: reviewId(81), content: [{ text: "Une cellule éditoriale" }] },
                {
                  id: reviewId(82),
                  content: [{ text: "Une valeur avec un texte particulièrement long" }],
                },
              ],
            },
            {
              id: reviewId(83),
              cells: [
                { id: reviewId(84), content: [{ text: "Seconde ligne" }] },
                { id: reviewId(85), content: [{ text: "Les cellules gardent leur contenu" }] },
              ],
            },
          ],
        },
        {
          id: reviewId(86),
          type: "embed",
          provider: "bookmark",
          sourceUrl: "https://example.org/",
          caption: "Une référence externe",
        },
        {
          id: reviewId(87),
          type: "unknown",
          declaredType: "future-block",
          raw: { type: "future-block", id: reviewId(87), value: "Conservé" },
          syntheticId: false,
        },
        { id: reviewId(88), type: "paragraph", content: [] },
      ],
    }),
  );
  return (
    <PageEditor
      pageId={reviewId(42)}
      handleRef={handleRef}
      items={[]}
      editable
      session={session}
      fileTransfersEnabled={false}
      document={canonicalV3ToLegacyV2(session.read())}
    />
  );
}

export function UiLabReview({ surface }: { readonly surface: ReviewSurface }) {
  return (
    <main className="ui-lab ui-lab--review">
      <header className="ui-lab__header">
        <h1>Revue des interfaces</h1>
        <p>Composants réels, exemples locaux. Les actions restent isolées de votre espace.</p>
      </header>
      <nav className="ui-lab__row" aria-label="Surfaces de revue">
        <LinkButton size="compact" variant="ghost" href="/__ui-lab">
          Composants
        </LinkButton>
        {surfaces.map((name) => (
          <LinkButton
            size="compact"
            variant="ghost"
            key={name}
            href={`?review=${name}`}
            aria-current={name === surface ? "page" : undefined}
          >
            {surfaceLabels[name]}
          </LinkButton>
        ))}
      </nav>
      <div className="ui-lab__section ui-lab__review-content">
        {surface === "conflicts" ? (
          <>
            <ConflictResolution
              service={reviewConflictService}
              itemId={reviewId(42)}
              onResolved={() => undefined}
              onCancel={() => undefined}
            />
            <StructuredConflictCard
              row={reviewStructuredConflict}
              service={reviewConflictService}
              onResolved={() => undefined}
            />
            <PageAmbiguityNotice records={[reviewAmbiguity]} onResolve={() => undefined} />
          </>
        ) : surface === "files" ? (
          <PreviewFiles />
        ) : surface === "history" ? (
          <PreviewHistory />
        ) : surface === "database" ? (
          <PreviewDatabases />
        ) : surface === "properties" ? (
          <PreviewProperties />
        ) : surface === "recovery" ? (
          <ReviewRecovery />
        ) : surface === "desktop" ? (
          <ReviewDesktop />
        ) : surface === "states" ? (
          <ReviewStates />
        ) : surface === "backup" ? (
          <ReviewBackup />
        ) : (
          <PreviewEditor />
        )}
      </div>
    </main>
  );
}
