# Quickstart: Validate the Block Editor

## Prerequisites

- Use the Node.js and pnpm versions pinned by the repository.
- Start the existing PostgreSQL development service and apply migrations as documented in `docs/development.md`.
- Install dependencies with the frozen lockfile after the feature dependency update is committed.

## Start the application

```text
docker compose up --detach --wait postgres
pnpm db:migrate
pnpm dev
```

Open the loopback web URL printed by the development command. Do not expose it to another network because authentication is outside this feature.

## Scenario 1: rich page editing

1. Create and select a page.
2. Confirm that the editor appears instead of the former JSON textarea.
3. Add a heading, paragraph with every text mark, bullet list, numbered list, checklist, quote, code block, and divider.
4. Use undo and redo, then reload the page.
5. Confirm that content, order, formatting, and checklist state remain unchanged.
6. Select a folder and a file and confirm that neither exposes the page editor.

## Scenario 2: commands and shortcuts

1. Type `/` at the start of an empty block.
2. Filter the menu, navigate with arrow keys, insert a block with Enter, and dismiss another attempt with Escape.
3. Repeat using the documented Markdown-like prefixes.
4. Confirm that a slash or prefix typed in the middle of ordinary text does not transform the block.

## Scenario 3: offline durability

1. Load a page while the API is available.
2. Make an edit and observe local and synchronization state.
3. Stop the API, edit again, and reload the browser.
4. Confirm that the complete edit and pending status remain available.
5. Restart the API and confirm that the edit synchronizes once.
6. Exercise the conflict fixture and confirm that both versions remain recoverable.

## Automated validation

```text
pnpm format:check
pnpm lint:ci
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
```

Expected outcomes are defined in `spec.md`; the canonical v2 shape is documented in `data-model.md` and `contracts/editor-document.schema.json`.
