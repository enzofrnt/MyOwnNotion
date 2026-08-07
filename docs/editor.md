# Block editor

The page editor stores a versioned structured document, not rendered HTML. It appears only for pages; folders and files never expose editable page content.

## Supported content

The editor supports paragraphs, headings 1–3, bullet and numbered lists, task lists, quotes, code blocks, and dividers. Text supports bold, italic, strike-through, and inline code. The toolbar and all editing actions are keyboard accessible, including undo and redo.

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

## Saving and offline behavior

Edits are automatically coalesced after a short pause. Only one local document replacement is written at a time; if typing continues, only the newest queued snapshot is saved next. The local page projection and outbox entry commit in one IndexedDB transaction before the editor reports a local save.

The editor distinguishes editing, saving locally, saved locally, and local failure. The workspace status separately distinguishes pending synchronization, synchronizing, synchronized, offline, and conflict. “Saved locally” never claims that the server has accepted the change.

A previously loaded page remains editable without the API. Reloading while offline reads the structured document and pending mutation from IndexedDB. Reconnection submits the stable mutation identity with its causal revision. A stale-base rejection retains the local mutation and competing revision in the conflict store; automatic rich-text merging is intentionally out of scope.

## Format and compatibility

Canonical page content uses the `myownnotion.document+json` envelope with `formatVersion: 2`. Its body is a validated Tiptap JSON document rooted at `doc`; accepted node and mark names are allow-listed in the domain package and in `specs/002-block-editor/contracts/editor-document.schema.json`.

Legacy version 1 empty pages normalize in memory to one empty paragraph and upgrade only after the owner edits and saves. Unknown future versions, blocks, marks, attributes, or malformed nesting produce a visible incompatibility state and leave stored content unchanged. They are never silently stripped.

Workspace export includes the complete versioned JSON document. Application diagnostics redact request bodies and nested editor text.

## Testing

Run the focused checks during editor work:

```text
pnpm exec vitest run --project web-unit --project client-core
pnpm exec playwright test tests/e2e/block-editor*.spec.ts tests/e2e/slash-command.spec.ts tests/e2e/markdown-shortcuts.spec.ts
pnpm exec vitest run --project performance tests/performance/block-editor.perf.spec.ts
```

The complete repository gates remain documented in [development.md](./development.md). The production-like application opens at `http://127.0.0.1:8080` when started through [deployment.md](./deployment.md); it must remain loopback-only until authentication exists.
