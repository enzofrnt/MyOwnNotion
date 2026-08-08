# Block editor

The page editor stores a versioned structured document, not rendered HTML. It appears only for pages; folders and files never expose editable page content.

## Supported content

The editor supports paragraphs, headings 1–3, bullet and numbered lists, task lists, quotes, code blocks, and dividers. Text supports bold, italic, strike-through, inline code, and stable links to other pages. The toolbar and all editing actions are keyboard accessible, including undo and redo.

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

## Saving and offline behavior

Edits are automatically coalesced after a short pause. Only one local document replacement is written at a time; if typing continues, only the newest queued snapshot is saved next. The local page projection and outbox entry commit in one IndexedDB transaction before the editor reports a local save.

The editor distinguishes editing, saving locally, saved locally, and local failure. The workspace status separately distinguishes pending synchronization, synchronizing, synchronized, offline, and conflict. “Saved locally” never claims that the server has accepted the change.

A previously loaded page remains editable without the API. Reloading while offline reads the structured document and pending mutation from IndexedDB. Reconnection submits the stable mutation identity with its causal revision. A stale-base rejection retains the local mutation and competing revision in the conflict store; automatic rich-text merging is intentionally out of scope.

## Format and compatibility

Canonical page content uses the `myownnotion.document+json` envelope with `formatVersion: 3`. Its body is a validated Tiptap JSON document rooted at `doc`; accepted node and mark names are allow-listed in the domain package and in `specs/003-links-knowledge-graph/contracts/wiki-link-document.schema.json`. A `wikiLink` mark stores a target UUID and occurrence UUID. Version 2 documents remain readable and upgrade only when edited and saved.

Legacy version 1 empty pages normalize in memory to one empty paragraph and upgrade only after the owner edits and saves. Unknown future versions, blocks, marks, attributes, or malformed nesting produce a visible incompatibility state and leave stored content unchanged. They are never silently stripped.

Workspace export includes the complete versioned JSON document and every active derived `link:references` relationship, including its occurrence identity and revision lineage. The export remains canonical JSON: importing or independently validating it must preserve both the inline occurrence and relationship projection. Application diagnostics redact request bodies, link queries, graph labels, and nested editor text.

## Testing

Run the focused checks during editor work:

```text
pnpm exec vitest run --project web-unit --project client-core
pnpm exec playwright test tests/e2e/block-editor*.spec.ts tests/e2e/slash-command.spec.ts tests/e2e/markdown-shortcuts.spec.ts
pnpm exec vitest run --project performance tests/performance/block-editor.perf.spec.ts
pnpm exec playwright test tests/e2e/wiki-links*.spec.ts tests/e2e/backlinks.spec.ts tests/e2e/knowledge-graph.spec.ts
pnpm exec vitest run --project performance tests/performance/knowledge-graph.perf.spec.ts
```

The complete repository gates remain documented in [development.md](./development.md). The production-like application opens at `http://127.0.0.1:8080` when started through [deployment.md](./deployment.md); it must remain loopback-only until authentication exists.
