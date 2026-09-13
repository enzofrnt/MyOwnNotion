# Validation guide

Use pinned Bun 1.4.2 and `bun install --frozen-lockfile`. Run focused Vitest web
editor/highlighter tests and `bun run --filter @myownnotion/web typecheck`.
Build using `MYOWNNOTION_E2E_BUILD=1 bun run --filter @myownnotion/web build`.
With an isolated test PostgreSQL database and the standard E2E environment, run
`bun run --bun playwright test tests/e2e/code-block-ui.spec.ts --project chromium-desktop`.
Follow `docs/development.md` for the complete supported browser matrix and
required container equivalents; use `bun run checks:local` before any push.

Inspect light/dark screenshots with multiline code and a long line at 320 px.
Choose TypeScript, edit inside a colored token, change language, undo/redo,
compose Unicode, copy exact text, deny clipboard and retry. Reload cached content
offline, then reconcile an owner-device edit. Confirm canonical text/language
and absence of syntax span markup in persisted data.
