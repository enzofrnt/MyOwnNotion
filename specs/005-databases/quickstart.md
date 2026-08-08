# Quickstart: Validate Structured Databases

## Start the application

Use the pinned Node.js and pnpm versions, start PostgreSQL, apply reviewed migrations, and run the existing development composition as documented in `docs/development.md`.

## Scenario 1: schema and records

1. Create or select a page and insert a database through the toolbar or `/database` command.
2. Add text, number, select, date, checkbox, and relation properties.
3. Add at least three records and edit representative values, including a leap-day date and record relation.
4. Remove one property and confirm its column and all of its values disappear together.
5. Save and reload; confirm stable records and values remain.

## Scenario 2: table search and sorting

1. In table view, search by a record title and by a visible property value.
2. Sort ascending and descending by title, number, select, date, checkbox, and relation.
3. Confirm the explicit result count and deterministic order.
4. Enter a query with no match and confirm the empty state.

## Scenario 3: board and gallery parity

1. Choose a select property for board grouping.
2. Switch table → board → gallery without clearing the current query or sort.
3. Confirm the same record count and identities in all three views.
4. Open one record from each view and confirm its labelled editor receives focus.
5. Verify table/board overflow stays inside the block on a mobile-sized viewport.

## Scenario 4: relations and offline recovery

1. Relate records, rename a target, and confirm the relation resolves its current title.
2. Disconnect the API, edit schema and records, reload, and use all three views.
3. Reconnect and confirm one complete synchronized result.
4. Exercise a competing revision and confirm the complete local database remains recoverable.

## Scenario 5: export and production restart

1. Export the workspace and verify the exact version-5 database document validates and round-trips.
2. Start the production-like Compose stack, create a database fixture, stop and restart it, and verify schema, record, relation, and current view persistence.
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
