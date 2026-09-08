# Quickstart Validation: Canonical Content Foundations


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

This guide describes the runnable validation flow expected after implementation. Commands are intentionally local and use disposable development data.

## Prerequisites

- Docker with Compose v2
- Node.js 24 LTS
- Corepack and the exact pnpm release declared by root package metadata
- Ports used by the API, web client, and development PostgreSQL available

This feature uses no Python runtime. If a later feature adds first-party Python, install and run it through uv using the committed interpreter pin and lockfile. Do not create a separate pip, Poetry, Pipenv, or Conda workflow.

## Start the development environment

```text
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

All repository dependency and script commands use pnpm. Do not create `package-lock.json`, `yarn.lock`, or `bun.lock` files.

Expected result:

- PostgreSQL reports healthy before the API starts accepting requests.
- Every published development port is bound to `127.0.0.1`, not all host interfaces.
- The API health endpoint reports the schema version.
- The web client opens the single development workspace.
- Editing source files triggers development reload without rebuilding production images.

## Validate the primary hierarchy journey

1. Create a folder named `Projects` at the workspace root.
2. Create a page named `MyOwnNotion` inside it.
3. Create another folder and page beneath that page.
4. Move the complete `MyOwnNotion` branch to the workspace root.
5. Confirm every descendant moved and the stable IDs did not change.
6. Attempt to move `MyOwnNotion` beneath one of its descendants.

Expected result: the valid branch move is atomic; the cycle attempt is rejected and leaves the prior tree unchanged.

## Validate internal page links versus hierarchy children

1. Create a page `Index` with a child page `Child` placed beneath it.
2. From `Index`'s editor, insert an internal link to a separate page `Reference`.
3. Confirm `Child` appears in the hierarchy while `Reference` appears only as a link in the document and as a `page-link` relationship.
4. Move or rename `Reference`, then follow the link again.
5. Link `Index` to `Child` and confirm the link remains non-hierarchical and does not create a cycle or a second placement.

Expected result: hierarchy placements and internal page links remain separate,
stable, and independently visible after reload.

## Validate file identity and placements

1. Import one file into a page.
2. Add the same canonical file to a second page and to the hierarchy.
3. Confirm all three placements expose one logical file identity and one stored content object.
4. Remove one placement and confirm the other two remain.
5. Remove the final placements and confirm the file enters the 30-day trash.
6. Restore it and confirm its last placement can be restored.
7. Import identical bytes as a new file and confirm it receives a different logical identity.
8. Modify the new logical file and confirm the original remains byte-for-byte unchanged.
9. Replace the original file through one placement and confirm every placement of that logical file exposes the new content while the independently imported file remains unchanged.

## Validate revision lineage

1. Create a page revision, then two sequential descendants.
2. Create two test revisions independently from the same parent.
3. Query lineage classification for representative identical, ancestor, descendant, and concurrent pairs.
4. Expire a superseded snapshot in the test clock while keeping its revision header.
5. Re-run classification.
6. Before expiry, restore a superseded snapshot and confirm restoration creates a new descendant revision without rewriting prior history.

Expected result: classifications remain correct after snapshot pruning and do not change when device timestamps are deliberately skewed.

## Validate offline use and reconnection

1. Load the workspace and open representative pages while the API is available.
2. Stop or block the API and reload the browser application.
3. Confirm the loaded hierarchy and page documents remain readable.
4. Create a page, reorder siblings, edit a page document, and move an item offline.
5. Close and reopen the browser while the API remains unavailable.
6. Confirm the offline state and pending mutations are still visible.
7. Restore the API and submit the durable outbox with duplicate transport delivery enabled.
8. Confirm each logical mutation is accepted once and the client reaches the returned change cursor.
9. Repeat with a competing server revision and confirm the local work remains in an explicit unresolved-conflict record.

Expected result: offline success is reported only after local state and outbox are durable; reconnection loses no accepted local work.

## Validate trash and backup representation contract

1. Trash a page branch.
2. Export the canonical workspace before the 30-day deadline.
3. Confirm the export includes the branch, descendants, relationships, deletion time, recovery deadline, and lineage.
4. Advance the test clock to the deadline and verify purge eligibility without executing an unrequested backup policy.

## Run automated quality gates

```text
pnpm toolchain:check
pnpm format:check
pnpm lint
pnpm shell:check
pnpm typecheck
pnpm test:coverage
pnpm test:unit
pnpm test:property
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
```

Expected result: every command exits successfully. The coverage gate meets or exceeds 90% statements, lines, and functions and 85% branches without using exclusions to hide maintained executable code. Playwright runs desktop and mobile viewport projects across Chromium, Firefox, and WebKit, forbids focused tests in CI, and retains reports and traces for failures.

The GitHub Actions workflow combines the same checks into the required `quality-gate` status. The protected `main` ruleset must reject a pull request when that status fails, is cancelled, is skipped, or is missing.

## Validate migrations

```text
pnpm db:test-migrations
```

Expected result: migrations succeed from an empty PostgreSQL database and from every maintained fixture version; destructive schema changes are never applied through an unreviewed schema-push command.

## Validate the local-only composition

```text
docker compose config
```

Expected result: the merged development configuration is valid, persistent paths are explicit, and API, web, and database ports bind only to `127.0.0.1`. No supported production composition is created before authentication.
