import { asUuid, type DatabaseProperty, type DatabaseView, type Uuid } from "@myownnotion/domain";
import { useState } from "react";
import { BoardView } from "../features/databases/board-view.tsx";
import { type DatabaseCellUpdate, TableView } from "../features/databases/table-view.tsx";
import { PageTitleEditor } from "../features/workspace/page-title-editor.tsx";
import type { DatabaseViewPage } from "../services/databases.ts";
import { AppIcon } from "./icons.tsx";
import {
  AsyncState,
  Button,
  ConfirmDialog,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  Field,
  Switch,
} from "./primitives/index.ts";

// Synthetic fixtures: no workspace, persistence, network or owner data.
const id = (n: number): Uuid => asUuid(`018f4000-0000-7000-8000-${n.toString().padStart(12, "0")}`);
const options = [
  { id: id(10), label: "Pas commencé", positionKey: "a", tone: "gray", state: "active" },
  { id: id(11), label: "En cours", positionKey: "b", tone: "blue", state: "active" },
  { id: id(12), label: "Terminé", positionKey: "c", tone: "green", state: "active" },
] as const;
const properties: readonly DatabaseProperty[] = [
  { id: id(1), name: "Nom", type: "title", positionKey: "a", state: "active", config: {} },
  {
    id: id(2),
    name: "État",
    type: "status",
    positionKey: "b",
    state: "active",
    config: { options },
  },
];
const table: Extract<DatabaseView, { type: "table" }> = {
  id: id(3),
  name: "Table",
  type: "table",
  positionKey: "a",
  state: "active",
  properties: [
    { propertyId: id(1), visible: true, positionKey: "a", width: 320 },
    { propertyId: id(2), visible: true, positionKey: "b", width: 200 },
  ],
  filter: { mode: "all", criteria: [] },
  sorts: [],
  group: null,
  options: { density: "comfortable", freezeTitle: true },
};
const board: Extract<DatabaseView, { type: "board" }> = {
  ...table,
  id: id(4),
  name: "Tableau kanban",
  type: "board",
  options: { axisPropertyId: id(2), columnOrder: [], collapsedColumnIds: [] },
};
const initialPage: DatabaseViewPage = {
  databaseId: id(5),
  viewId: id(3),
  definitionRevisionId: id(6),
  generation: 1,
  coverage: "complete",
  availableCount: 2,
  expectedCount: 2,
  rows: [
    {
      entryId: id(7),
      revisionId: id(6),
      title: "Préparer la prochaine version",
      values: { [id(2)]: { kind: "status", optionId: id(11) } },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
    },
    {
      entryId: id(8),
      revisionId: id(6),
      title: "Un projet avec un nom particulièrement long qui garde ses actions accessibles",
      values: { [id(2)]: { kind: "status", optionId: id(10) } },
      relationTargets: {},
      groupId: null,
      syncState: "synced",
      itemKind: "folder",
    },
  ],
  groups: [],
  nextCursor: null,
  source: "local",
  staleCursorRecovered: false,
};

export function UiLabCompositions({
  initialView = "table",
}: {
  readonly initialView?: "table" | "board";
}) {
  const [title, setTitle] = useState("Projets de recherche");
  const [view, setView] = useState<"table" | "board">(initialView);
  const [tableView, setTableView] = useState(table);
  const [boardView, setBoardView] = useState(board);
  const [page, setPage] = useState(initialPage);
  const [empty, setEmpty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<Uuid | null>(null);
  const [notifications, setNotifications] = useState(true);
  const [navigation, setNavigation] = useState("Rechercher");
  const [note, setNote] = useState("Conserver une interface calme et des actions prévisibles.");
  const selectedRow = page.rows.find(({ entryId }) => entryId === selectedEntry);
  const displayPage = empty ? { ...page, rows: [], availableCount: 0, expectedCount: 0 } : page;
  const updateEntry = (entryId: Uuid, update: DatabaseCellUpdate) =>
    setPage((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.entryId !== entryId) return row;
        if (update.kind === "title") return { ...row, title: update.title };
        const values = { ...row.values };
        if (update.value === undefined) delete values[update.propertyId];
        else
          values[update.propertyId] =
            update.value.kind === "multi-select"
              ? { ...update.value, optionIds: [...update.value.optionIds] }
              : update.value;
        return { ...row, values };
      }),
    }));

  return (
    <section className="ui-lab__section" aria-labelledby="ui-lab-compositions">
      <h2 id="ui-lab-compositions">Compositions de l’application</h2>
      <p className="ui-lab__hint">
        Les composants réels, avec des exemples locaux. Les modifications restent dans ce
        laboratoire.
      </p>
      <div className="ui-lab__composition">
        <div className="database-container-page">
          <PageTitleEditor
            title={title}
            kind="database"
            breadcrumbs="Notes / Recherche"
            onCommit={async (next) => setTitle(next)}
          />
          <div className="database-container-page__topbar">
            <nav className="database-container-page__tabs" aria-label="Formats de l’exemple">
              <button
                type="button"
                aria-current={view === "table" ? "page" : undefined}
                onClick={() => setView("table")}
              >
                <AppIcon name="table" /> Table
              </button>
              <button
                type="button"
                aria-current={view === "board" ? "page" : undefined}
                onClick={() => setView("board")}
              >
                <AppIcon name="kanban" /> Tableau kanban
              </button>
            </nav>
            <Button
              size="compact"
              variant="ghost"
              aria-pressed={loading}
              disabled={view !== "table"}
              onClick={() => setLoading(!loading)}
            >
              Chargement
            </Button>
            <Button
              size="compact"
              variant="ghost"
              aria-pressed={empty}
              disabled={loading}
              onClick={() => setEmpty(!empty)}
            >
              {empty ? "Remplir" : "Vider"}
            </Button>
          </div>
          <div className="ui-lab__view-preview">
            {loading && view === "table" ? (
              <AsyncState
                kind="loading"
                loadingLayout="table"
                loadingRows={3}
                description="Préparation des projets de recherche"
              />
            ) : view === "table" ? (
              <TableView
                properties={properties}
                view={tableView}
                page={displayPage}
                onOpenEntry={setSelectedEntry}
                onUpdateEntry={updateEntry}
                onResize={(propertyId, width) =>
                  setTableView((current) => ({
                    ...current,
                    properties: current.properties.map((property) =>
                      property.propertyId === propertyId ? { ...property, width } : property,
                    ),
                  }))
                }
              />
            ) : (
              <BoardView
                properties={properties}
                view={boardView}
                page={displayPage}
                onOpenEntry={setSelectedEntry}
                onUpdateEntry={updateEntry}
                onChangeView={setBoardView}
              />
            )}
          </div>
          {empty && !loading && view === "table" ? (
            <AsyncState
              kind="empty"
              compact
              description="Aucun projet. Utiliser Remplir pour retrouver les exemples."
            />
          ) : null}
          <DialogRoot
            open={selectedEntry !== null}
            setOpen={(open) => {
              if (!open) setSelectedEntry(null);
            }}
          >
            <DialogContent>
              <DialogHeading>{selectedRow?.title ?? "Page de référence"}</DialogHeading>
              <DialogDescription>
                Exemple local d’une entrée ouverte depuis sa vue.
              </DialogDescription>
              <DialogDismiss />
            </DialogContent>
          </DialogRoot>
        </div>
      </div>

      <div className="ui-lab__grid ui-lab__recipes">
        <div className="ui-lab__composition">
          <h3 className="ui-lab__composition-title">Navigation secondaire</h3>
          <div className="ui-lab__navigation-frame">
            <nav className="workspace-navigation" aria-label="Outils de référence">
              {(["Rechercher", "Graphe"] as const).map((label) => (
                <Button
                  key={label}
                  variant="ghost"
                  className={
                    label === "Rechercher"
                      ? "workspace-navigation__search"
                      : "workspace-navigation__graph"
                  }
                  aria-pressed={navigation === label}
                  onClick={() => setNavigation(label)}
                >
                  <AppIcon name={label === "Rechercher" ? "search" : "graph"} />
                  {label}
                </Button>
              ))}
            </nav>
          </div>
          <p className="ui-lab__hint" role="status">
            Outil sélectionné : {navigation}
          </p>
        </div>
        <div className="ui-lab__composition settings-content" data-section="security">
          <h3 className="ui-lab__composition-title">Réglages en document</h3>
          <ul className="security-settings__rows">
            <li>
              <div className="security-settings__row-main">
                <span className="security-settings__row-label">
                  Notifications sur cet appareil avec un nom particulièrement long
                </span>
                <span className="security-settings__row-meta">
                  Une aide discrète et une action à côté du contenu.
                </span>
              </div>
              <div className="security-settings__row-actions">
                <Switch
                  aria-label="Notifications de référence"
                  checked={notifications}
                  onCheckedChange={setNotifications}
                />
              </div>
            </li>
          </ul>
          <Field id="lab-local-name" label="Nom de l’espace" defaultValue="Carnet personnel" />
        </div>
      </div>

      <div className="ui-lab__grid ui-lab__recipes">
        <div className="ui-field">
          <label className="ui-field__label" htmlFor="lab-native-select">
            Densité de référence
          </label>
          <select className="ui-native-select" id="lab-native-select" defaultValue="comfortable">
            <option value="comfortable">Confortable</option>
            <option value="compact">Compacte</option>
          </select>
        </div>
        <div className="ui-field" data-invalid={note.length === 0 || undefined}>
          <label className="ui-field__label" htmlFor="lab-native-textarea">
            Note de référence
          </label>
          <textarea
            className="ui-native-textarea"
            id="lab-native-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={note.length === 0 || undefined}
            aria-describedby={note.length === 0 ? "lab-native-error" : undefined}
          />
          {note.length === 0 ? (
            <span className="ui-field__error" id="lab-native-error" role="alert">
              Ajouter une note pour conserver cet exemple.
            </span>
          ) : null}
        </div>
      </div>
      <div className="ui-lab__row ui-lab__recipes">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Supprimer l’exemple
        </Button>
        <ConfirmDialog
          open={confirming}
          title="Supprimer cet exemple ?"
          description="Les lignes du laboratoire seront masquées. Remplir permet de les retrouver."
          confirmLabel="Supprimer l’exemple"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setEmpty(true);
            setConfirming(false);
          }}
        />
      </div>
    </section>
  );
}
