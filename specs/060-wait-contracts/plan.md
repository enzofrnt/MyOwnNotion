# Implementation Plan: Tests Wait for States, Not for Time

**Spec**: [spec.md](spec.md) · **Audit**: `docs/audits/2026-11-wait-contracts/`
· **Doctrine**: [`docs/testing/wait-contracts.md`](../../docs/testing/wait-contracts.md)

## Approach (adapted from the audit's PLAN-OPUS)

The audit proposed new application counters (`data-save-sequence`,
`data-definition-sequence`) and a `readPresentationState()` method. Reading the
code showed that committed state already carries what the witnesses need, and
the E2E build already exposes the application's service:

- navigation: `db.meta` row `navigation-state`;
- items: `listActiveItems()` / `getItem()` (projection committed with its
  outbox row by `apply-local-mutation.ts`);
- database definitions and views: `definitionVersion` / `presentationVersion`
  from `listDatabases()`;
- entry values: `valueVersion` from `getDatabaseEntry()`.

So no application code changes: the witnesses read these states
(`tests/e2e/waits/local-state.ts`), which cannot be stale or missed because an
IndexedDB read is ordered after earlier read-write transactions on the same
store. Negative claims and WebSocket refusals use `tests/e2e/waits/observation.ts`.
React unit tests use `apps/web/tests/support/until.ts` (`until`, `present`,
`drainPromiseWork`).

| Lot | Content |
| --- | --- |
| L0 | Per-attempt CI artifacts and lane selection (`scripts/ci/select-lane-blobs.sh`); witnesses over committed state |
| L1 | Shared helpers (`tests/e2e/waits/`, `apps/web/tests/support/until.ts`); creation helpers wait for the committed name |
| L2 | P1 sites W-01…W-07 |
| L3 | P2 E2E sites |
| L4 | Unit and integration sites, plus the API tests the audit missed |
| L4bis | Owned clocks (backoff, vacuum, UUID instants) |
| L5 | `tests/contract/test-wait-contracts.spec.ts`, doctrine, links from `docs/development.md` and `AGENTS.md` |

## Decisions

D-A, D-B and D-C are recorded in the doctrine (§ Decisions), with the spec
passages they rest on.

## Validation

See [validation.md](validation.md).
