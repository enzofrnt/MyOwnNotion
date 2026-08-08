# Block editor

The page editor stores a versioned structured document, not rendered HTML. It appears only for pages; folders and files never expose editable page content.

## Supported content

The editor supports paragraphs, headings 1–3, bullet and numbered lists, task lists, structured databases, freeform canvases, quotes, code blocks, and dividers. Text supports bold, italic, strike-through, inline code, and stable links to other pages. The toolbar and all editing actions are keyboard accessible, including undo and redo.

Type `/` at the beginning of an empty block to open the local command menu. Continue typing to filter, use the arrow keys to move, Enter to insert, and Escape to dismiss. The menu performs no network request.

The documented start-of-block shortcuts are:

| Block | Input |
| --- | --- |
| Heading 1–3 | `# `, `## `, `### ` |
| Bullet list | `- ` |
| Numbered list | `1. ` |
| Task list | `[ ] ` |
| Quote | `> ` |
| Code block | `` ``` `` followed by Space |
| Divider | `---` |

Matching text in the middle of a block remains ordinary text. Immediately after a heading transformation, Cmd/Ctrl+Z restores the literal prefix before normal history takes over.

## Page links, backlinks, and graph

Type `[[` anywhere in a text block to search the active pages already available on the device. Continue typing to filter, use Up/Down and Enter or a pointer to choose a page, and Escape to close the menu. The current page is excluded. The readable label is inserted into the document, while navigation uses the target's stable identity, so renames and hierarchy moves do not break the link.

The selected page's **Backlinks** and **Outgoing links** sections aggregate repeated occurrences and show their exact count. An active entry can be opened with a pointer or keyboard. Trashed or unavailable endpoints remain labelled and diagnosable instead of being silently redirected.

The **Local graph** contains the selected page and its directly connected active pages. The **Global graph** contains all active linked pages. Both modes offer filtering, a selection summary, and an equivalent semantic list for keyboard or assistive-technology navigation. Graph positions are deterministic views, not user-owned canvas state.

## Tasks and planning views

Every task-list item saved in the current format receives a stable task identity. Place the caret inside a task to edit its labelled status, due-date, and priority controls. The fixed statuses are To do, In progress, Completed, and Cancelled; priorities are None, Low, Medium, and High. Due dates are calendar days without a time or time-zone conversion. Checking a task completes it, while unchecking a completed task reopens it as To do.

The workspace **Tasks** surface derives its results directly from locally durable page documents. **Today**, **Upcoming**, and **Overdue** contain active dated tasks relative to the device's local calendar day; **Finished** contains completed and cancelled tasks. Text, status, and priority filters, deterministic sorting, list view, and status board all operate on the same task identities. Activating a result opens its source page and focuses the task.

Task pages saved in document versions 1–3 remain readable, but legacy checklist items do not enter cross-page planning until the page is opened and explicitly saved. This assigns durable identities without a background rewrite. Trashed page tasks are omitted from active planning views and return if their page is restored.

## Structured databases

Insert a database from the toolbar or the `/database` slash command. Each database belongs to one page and keeps stable identities for its database, properties, select options, records, and relation targets. Open **Properties** to add or rename text, number, select, date, checkbox, and relation properties. Select options can be added, renamed, and removed with labelled controls. Removing a property removes its cells and any dependent sort or board grouping in the same save.

Add records below the view controls and edit their typed cells in the table. Dates use `YYYY-MM-DD`, numbers remain numeric, checkbox state is explicit, and relations select records from the same database. A relation follows a target rename because it stores the target record identity. If the target is later removed, the stored identity remains diagnosable as unavailable instead of being silently redirected.

The search field matches record titles and readable property values. Sort by title or any property in ascending or descending order; empty values remain last. The displayed result count and empty state reflect the current query. **Table**, **Board**, and **Gallery** preserve the same query, sort, record identities, and order. Board grouping accepts a select property and exposes every option plus **Unassigned**. Gallery cards show a bounded summary; activating a board or gallery card focuses its labelled record editor.

Database limits are enforced at the document boundary: at most 20 properties, 1,000 records, 50 options per select property, and 200 relation targets per cell. Formulas, record-as-page behavior, cross-database relations, and server-side database queries are intentionally outside this increment.

## Freeform canvases

Insert a canvas from the toolbar or the `/canvas` slash command. A canvas belongs to its page and stores stable identities for the canvas, every card, connection, and freehand stroke. Add text cards for short notes or page cards for active workspace pages. Page-card labels resolve from the current page name, so renaming or moving a target does not break the reference. An unavailable target stays explicit and is never silently redirected.

Select a card to edit its text, size, or position with labelled controls; cards also support pointer dragging. Pan and zoom change the stored viewport without changing world geometry, and **Reset view** returns to the origin at 100%. Connections are directed, may have a readable label, follow card centers as geometry changes, and remain available in a semantic list. Draw mode commits a freehand stroke only when a complete gesture finishes; thin, medium, and thick widths are supported. Removing a card removes only its incident connections, while strokes remain independent.

Canvas limits are enforced at the document boundary: at most 500 cards, 1,000 directed connections, 200 strokes, and 1,000 points per stroke. Card coordinates remain bounded to ±1,000,000 canvas units. The surrounding page clips the spatial surface to avoid horizontal document overflow. Semantic card, connection, and stroke controls provide keyboard and assistive-technology paths independent of the SVG geometry.

## Saving and offline behavior

Edits are automatically coalesced after a short pause. Only one local document replacement is written at a time; if typing continues, only the newest queued snapshot is saved next. The local page projection and outbox entry commit in one IndexedDB transaction before the editor reports a local save.

The editor distinguishes editing, saving locally, saved locally, and local failure. The workspace status separately distinguishes pending synchronization, synchronizing, synchronized, offline, and conflict. “Saved locally” never claims that the server has accepted the change.

A previously loaded page remains editable without the API. Reloading while offline reads the structured document and pending mutation from IndexedDB. Reconnection submits the stable mutation identity with its causal revision. A stale-base rejection retains the local mutation and competing revision in the conflict store; automatic rich-text merging is intentionally out of scope.

## Format and compatibility

Canonical page content uses the `myownnotion.document+json` envelope with `formatVersion: 6`. Its body is a validated Tiptap JSON document rooted at `doc`; accepted node and mark names are allow-listed in the domain package and in the feature contracts under `specs/003-links-knowledge-graph/`, `specs/004-tasks/`, `specs/005-databases/`, and `specs/006-freeform-canvas/`. A `wikiLink` mark stores a target UUID and occurrence UUID. A current `taskItem` stores a task UUID, consistent checkbox and status, optional `YYYY-MM-DD` due date, and fixed priority. A `databaseBlock` stores its exact schema, records, typed values, relations, and current view. A `canvasBlock` stores cards, exact world geometry, directed connections, complete strokes, and its viewport as one atom. Page-card UUIDs also serve as derived `link:references` occurrence identities. Versions 2–5 remain readable and upgrade only when explicitly saved.

Legacy version 1 empty pages normalize in memory to one empty paragraph and upgrade only after the owner edits and saves. Unknown future versions, blocks, marks, attributes, or malformed nesting produce a visible incompatibility state and leave stored content unchanged. They are never silently stripped.

Workspace export includes the complete versioned JSON document, database schemas and records, canvas identities and geometry, all task identities and metadata, and every active derived `link:references` relationship, including page-card occurrences and revision lineage. The export remains canonical JSON: importing or independently validating it must preserve databases, canvases, inline tasks, link occurrences, and relationship projections. Application diagnostics redact request bodies, database names/values/queries, canvas text/labels/geometry/page targets/strokes/viewports, task titles/filters, link queries, graph labels, and nested editor text.

## Testing

Run the focused checks during editor work:

```text
pnpm exec vitest run --project web-unit --project client-core
pnpm exec playwright test tests/e2e/block-editor*.spec.ts tests/e2e/slash-command.spec.ts tests/e2e/markdown-shortcuts.spec.ts
pnpm exec vitest run --project performance tests/performance/block-editor.perf.spec.ts
pnpm exec playwright test tests/e2e/wiki-links*.spec.ts tests/e2e/backlinks.spec.ts tests/e2e/knowledge-graph.spec.ts
pnpm exec vitest run --project performance tests/performance/knowledge-graph.perf.spec.ts
pnpm exec vitest run --project domain --project web-unit --project client-core
pnpm exec playwright test tests/e2e/tasks-*.spec.ts
pnpm exec vitest run --project performance tests/performance/tasks.perf.spec.ts
pnpm exec vitest run packages/domain/tests/database.spec.ts apps/web/src/features/databases/database-block.spec.ts
pnpm exec playwright test tests/e2e/databases-*.spec.ts tests/e2e/revision-restore.spec.ts
pnpm exec vitest run --project performance tests/performance/databases.perf.spec.ts
pnpm exec vitest run packages/domain/tests/canvas.spec.ts packages/domain/tests/editor-document.spec.ts apps/web/src/features/canvas/canvas-block.spec.ts
pnpm exec playwright test tests/e2e/canvas-*.spec.ts tests/e2e/revision-restore.spec.ts
pnpm exec vitest run tests/performance/canvas.perf.spec.ts
```

The complete repository gates remain documented in [development.md](./development.md). The production-like application opens at `http://127.0.0.1:8080` when started through [deployment.md](./deployment.md); it must remain loopback-only until authentication exists.
