# Quickstart: CI Cache and Selective Tests


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

## Validate the policy contract

```bash
pnpm exec vitest run --project workspace-contract tests/contract/test-impact.spec.ts
```

This checks policy completeness, deterministic selection, full-suite fallbacks,
and workflow/cache invariants.

## Inspect a documentation-only plan

```bash
pnpm ci:test-impact --event pull_request --base HEAD~1 --head HEAD --changed docs/development.md
```

Expected result: `mode: none`, an E2E `none` sentinel, and successful no-op test
groups.

## Inspect narrow source and journey changes

```bash
pnpm ci:test-impact --event pull_request --base HEAD~1 --head HEAD --changed packages/domain/src/document/block.ts
pnpm ci:test-impact --event pull_request --base HEAD~1 --head HEAD --changed apps/web/src/features/editor/editor-view.tsx
```

The first plan uses Vitest related-test analysis. The second also selects the
declared editor E2E journeys.

## Verify fail-closed behavior

```bash
pnpm ci:test-impact --event pull_request --base HEAD~1 --head HEAD --changed pnpm-lock.yaml
pnpm ci:test-impact --event pull_request --base HEAD~1 --head HEAD --changed unknown-runtime.config.ts
```

Both plans must be full and explain the triggering path.

## Run one affected Vitest group

```bash
pnpm ci:test:affected --plan test-impact.json --group unit
pnpm ci:test:affected --plan test-impact.json --group performance
```

The runner performs a no-op, direct/related execution, or the complete existing
group according to the plan. Performance is a separate group so its timing
budgets are never distorted by coverage instrumentation and CI can run it in
parallel with coverage.

## Validate live GitHub behavior

For the first pull request after integration, inspect the impact summary and
confirm:

1. a documentation-only commit reports explicit no-op test jobs;
2. a narrow source commit runs only mapped tests and journeys;
3. a lockfile or CI-policy commit runs full relevant suites;
4. a rerun reports cache hits for pnpm, Playwright, and BuildKit;
5. a superseding commit cancels the obsolete PR run;
6. main/release runs remain full and use only trusted cache scopes.

## Required local gate

Before pushing:

```bash
pnpm checks:local
```

Selective execution never replaces this full documented gate.
