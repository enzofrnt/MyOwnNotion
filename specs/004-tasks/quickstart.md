# Quickstart: Validate Tasks and Planning Views

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

## Scenario 1: capture and complete a task

1. Create or select a page and insert a task through the toolbar, `/task`, or `[ ] ` shortcut.
2. Enter a title, leave the task, and return to it; confirm normal block editing remains available.
3. Toggle the checkbox with keyboard and pointer, then reopen the task.
4. Save and reload; confirm the task remains the same item and retains the expected state.

## Scenario 2: edit planning metadata

1. Place the caret inside a task and open its labelled task details.
2. Set status to in progress, assign a real calendar due date, and choose high priority.
3. Confirm each value is visible as text or a labelled semantic state, not color alone.
4. Complete, reopen, cancel, and reopen the task; confirm checkbox and status never disagree.
5. Clear the date and priority, save, reload, and restore a revision containing the metadata.

## Scenario 3: review list and board views

1. Create tasks across several pages with overdue, today, future, undated, completed, and cancelled combinations.
2. Open the task workspace and verify All, Today, Upcoming, Overdue, and Finished counts.
3. Combine text, status, and priority filters and exercise every deterministic sort.
4. Switch between list and status board; confirm identical task identities and counts.
5. Open a task result with keyboard and pointer; confirm its page opens and the task becomes a meaningful focus destination.
6. Trash and restore a source page and confirm active task visibility follows its lifecycle.

## Scenario 4: offline durability and conflict

1. Load task pages and planning views while the API is available.
2. Stop the API, create a task and change another task's metadata, then reload the browser.
3. Confirm the document, task views, and pending state remain available locally.
4. Restart the API and confirm each task identity synchronizes exactly once.
5. Exercise a competing-revision fixture and confirm the complete local task document remains recoverable without a partial view state.

## Scenario 5: production-like restart and review evidence

1. Build or retrieve API and web images using `docs/deployment.md` and `compose.prod.yaml`.
2. Create a version-4 task with status, due date, and priority; restart the composition and verify its editor and planning representations persist.
3. Confirm CI exposes desktop and mobile images or traces for capture, metadata, list, and board journeys to reviewers.

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

Expected outcomes are defined in `spec.md`; version-4 and task-projection contracts are documented under `contracts/`.
