# Research: CI Cache and Selective Tests

## Package dependency caching

**Decision**: Retain `actions/setup-node` with `cache: pnpm` and the repository
lockfile as the dependency path, followed by `pnpm install --frozen-lockfile`.

**Rationale**: The official cache stores pnpm's package data, so unchanged
packages are not downloaded again while pnpm still verifies and materializes the
lockfile-defined install. Caching `node_modules` would encode platform-specific
links and lifecycle results and would make invalidation harder to reason about.

## Browser binary caching

**Decision**: Cache Playwright's browser directory by runner OS, architecture,
and the pinned Playwright version, then run the normal install command on every
selected E2E job.

**Rationale**: A hit avoids browser downloads; the install command still checks
that the requested browser and system dependencies exist. The project matrix is
not part of the key because every project uses the same pinned Playwright bundle.

## Container layer caching

**Decision**: Use BuildKit's GitHub Actions cache backend in `mode=max`, with
separate API and web scopes and separate PR/main/release owners.

**Rationale**: Dockerfile cache mounts are otherwise ephemeral on hosted
runners. Target-specific scopes prevent API and web records from overwriting one
another. Trust-specific scopes prevent untrusted pull-request code from seeding
layers later imported by image publication.

**Rejected alternatives**:

- A single repository-wide BuildKit scope: targets overwrite each other's cache
  records and trust provenance is unclear.
- Importing PR scopes into main/release: faster in some cases but violates the
  trusted publication boundary.

## Vitest impact selection

**Decision**: Use Vitest's related-test graph for supported TypeScript source
changes, direct selection for changed tests and declared non-code consumers, and
full-suite fallbacks for broad or unknown executable changes.

**Rationale**: Static imports give useful precision for unit tests. They do not
model every runtime, environment, generated, or filesystem dependency, so the
policy declares those cases explicitly and fails closed.

## Playwright impact selection

**Decision**: Maintain an explicit ownership map from repository path prefixes
to E2E journey files. Every E2E file must appear in the map exactly once.

**Rationale**: Browser journeys often exercise API routes, persistence,
permissions, and UI behavior without importing those modules. A reviewed map is
auditable and can conservatively select multiple journeys for a change.

**Rejected alternative**: Playwright's changed-only heuristic is not the sole CI
gate because its static dependency analysis can omit indirect runtime effects.

## Empty selections and required checks

**Decision**: Required test jobs execute an explicit successful no-op when their
selection is empty. E2E uses a sentinel matrix entry.

**Rationale**: Workflow-level path filters or skipped jobs can leave required
checks missing or ambiguous. A no-op keeps branch protection stable and records
why no tests ran.

## Safety-net cadence

**Decision**: Selection applies only to pull requests. Pushes to main, release
workflows, manual runs, and `pnpm checks:local` execute the complete gate.

**Rationale**: Full trusted runs continuously detect incomplete mappings while
PR feedback benefits from narrower execution.
