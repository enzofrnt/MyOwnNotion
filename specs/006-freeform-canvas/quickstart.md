# Quickstart: Validate Freeform Canvas

## Start the application

Use the pinned Node.js and pnpm versions, start PostgreSQL, apply reviewed migrations, and run the existing development composition as documented in `docs/development.md`.

## Scenario 1: spatial text cards

1. Create or select a page and insert a canvas through the toolbar or `/canvas` command.
2. Add three text cards, edit their text, drag one, and keyboard-nudge another across the origin.
3. Resize one card and verify unrelated geometry does not change.
4. Pan, zoom, and reset; confirm the surrounding page never gains horizontal overflow.
5. Save and reload; confirm stable identities, geometry, and viewport remain.

## Scenario 2: connections and drawings

1. Connect two cards, name the connection, and confirm its semantic list entry.
2. Move and resize both endpoints; confirm the line follows while identity remains stable.
3. Enter draw mode and create thin and thick strokes.
4. Remove one stroke and one connected card; confirm only that stroke and the card's incident connections disappear.

## Scenario 3: page inclusion

1. Add two current workspace pages as page cards and connect them to text cards.
2. Rename and move a target page; confirm its canvas label resolves the current name.
3. Open the target through the card's labelled action.
4. Exercise an unavailable local target fixture and confirm it remains explicit without retargeting.

## Scenario 4: offline recovery

1. Load the canvas, disconnect the API, and edit cards, connections, drawings, and viewport.
2. Reload offline and confirm all complete edits remain usable.
3. Reconnect and confirm exactly one complete synchronized canvas.
4. Exercise a competing revision and confirm the complete local canvas remains recoverable.

## Scenario 5: export and production restart

1. Export the workspace and verify the exact version-6 canvas document plus page-card relationships validate and round-trip.
2. Start the production-like Compose stack, create a canvas fixture, stop and restart it, and verify cards, geometry, connection, stroke, page target, and viewport persistence.
3. Inspect desktop/mobile screenshots in the GitHub Playwright artifact.

## Automated validation

```text
pnpm format:check
pnpm lint:ci
pnpm typecheck
pnpm test:coverage
pnpm test:contract
pnpm test:performance
pnpm test:e2e
pnpm build
pnpm test:containers
```
