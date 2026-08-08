# Quickstart: Validate Links and Knowledge Graph

## Prerequisites

- Use the Node.js and pnpm versions pinned by the repository.
- Start the existing PostgreSQL development service and apply migrations as documented in `docs/development.md`.
- Install dependencies from the frozen lockfile.

## Start the application

```text
docker compose up --detach --wait postgres
pnpm db:migrate
pnpm dev
```

Open the loopback web URL printed by the development command. Authentication remains outside this feature, so do not expose the service to another network.

## Scenario 1: create and follow a wiki link

1. Create pages named Alpha and Beta, then select Alpha.
2. Type `[[be`, navigate the result menu with the keyboard, and insert Beta.
3. Confirm that editing continues after the inserted label and save the page.
4. Reload Alpha and activate the link using Enter, then repeat with a pointer.
5. Rename and move Beta, return to Alpha, and confirm the link still opens the same page.

## Scenario 2: backlinks and outgoing links

1. Add a second Beta occurrence in Alpha and one reciprocal Alpha link in Beta.
2. Confirm that Alpha reports one outgoing Beta entry with count 2.
3. Confirm that Beta reports one incoming Alpha entry with count 2 and one outgoing Alpha entry with count 1.
4. Delete one occurrence, save, and confirm the aggregate count becomes 1.
5. Delete the last occurrence and confirm both the outgoing entry and matching backlink disappear.
6. Trash and restore a target and verify explicit unavailable/restored status without redirection.

## Scenario 3: local and global graph

1. Create a four-page network containing a cycle, reciprocal links, and one isolated page.
2. Open the local graph for a selected page and confirm that only directly connected active pages appear.
3. Open the global graph and confirm every active linked page and aggregate directed edge appears once.
4. Filter by name, select nodes with keyboard and pointer, inspect connection summaries, and open a page.
5. Repeat navigation through the semantic list without relying on the visual graph.
6. Verify desktop and narrow mobile layouts have no page-level horizontal overflow.

## Scenario 4: offline durability and conflict

1. Load Alpha, Beta, backlinks, and graph while the API is available.
2. Stop the API, add a wiki link in Alpha, save, and reload the browser.
3. Confirm the document, backlink/outgoing projection, graph edge, and pending state remain available locally.
4. Restart the API and confirm exactly one occurrence synchronizes.
5. Exercise a competing-revision fixture and confirm the local linked document remains recoverable without a partial canonical relationship update.

## Scenario 5: production-like restart and review evidence

1. Build or retrieve the API and web images using `docs/deployment.md` and `compose.prod.yaml`.
2. Create a version-3 linked document, restart the composition, and verify link navigation, backlink count, and graph data persist.
3. Confirm CI exposes desktop and mobile images or traces for the principal link, backlink, and graph journeys to change reviewers.

## Automated validation

```text
pnpm format:check
pnpm lint:ci
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm test:performance
pnpm build
pnpm test:containers
```

Expected outcomes are defined in `spec.md`; version-3 and relationship-sync contracts are documented under `contracts/`.
