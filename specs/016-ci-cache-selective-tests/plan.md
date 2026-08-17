# Implementation Plan: CI Cache and Selective Tests

**Branch**: `agent/ci-cache-selective-tests` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-ci-cache-selective-tests/spec.md`

## Summary

Introduce a deterministic, fail-closed impact planner that turns a CI event and
an exact Git change set into explicit Vitest and Playwright selections. Pull
requests may use the affected selection; trusted pushes, releases, manual runs,
and the local pre-push gate remain full. Add reusable dependency, browser, and
BuildKit caches whose keys include every compatibility input and whose trust
scopes prevent pull requests from feeding trusted publication runs. Required
jobs remain visible and successful when no test is selected.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24; GitHub Actions YAML
**Primary Dependencies**: pnpm 10.33.3, Vitest 3.2.4, Playwright 1.62.1,
YAML 2.8, Docker Buildx, official GitHub cache-enabled actions
**Storage**: Committed JSON impact policy; per-run JSON impact plan; GitHub
Actions caches for package downloads, browsers, and BuildKit layers
**Testing**: Vitest contract tests for the planner and workflow invariants;
existing unit, integration, contract, Playwright, image, and release gates
**Target Platform**: GitHub-hosted Ubuntu runners and the documented local
container gate
**Project Type**: pnpm monorepo with web, API, shared packages, and container
images
**Performance Goals**: Avoid downloading unchanged dependencies and browser
binaries; reuse container layers across compatible runs; skip demonstrably
unaffected PR tests while preserving fail-closed behavior
**Constraints**: Pull-request data must not populate trusted caches; unknown or
ambiguous changes run the full relevant suite; required checks cannot disappear;
published images remain tied to the exact validated commit
**Scale/Scope**: Approximately 130 Vitest files, 24 Playwright journeys, five
browser/viewport projects, and two production images

## Constitution Check

| Principle | Gate | Status |
|-----------|------|--------|
| I. Privacy and Security by Design | Untrusted PR caches are isolated from trusted main/release scopes; policy fails closed. | PASS |
| II. Local-First Reliability | `pnpm checks:local` remains the complete pre-push gate and is never reduced by selection. | PASS |
| III. Explicit Data and State Semantics | The change set, impact rules, selected tests, reasons, and cache scopes are explicit artifacts. | PASS |
| IV. Specification-Driven Delivery | Feature 016 contains spec, plan, tasks, contracts, and validation evidence. | PASS |
| V. Testable Quality | Selection logic has contract tests; full trusted gates detect mapping drift. | PASS |

No constitutional exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/016-ci-cache-selective-tests/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── impact-plan.schema.json
├── checklists/
│   └── requirements.md
├── tasks.md
└── validation.md
```

### Source Code (repository root)

```text
ci/
└── test-impact.json

scripts/ci/
├── test-impact.ts
└── run-affected-vitest.ts

tests/contract/
├── test-impact.spec.ts
├── release-gates.spec.ts
└── release-artifacts.spec.ts

.github/workflows/
├── ci.yml
└── release.yml

package.json
scripts/ci/check-toolchain.ts
docs/development.md
```

**Structure Decision**: Keep CI policy and orchestration under the existing
`scripts/ci` boundary, with a small declarative manifest under `ci/`. Workflow
files consume the generated impact-plan contract rather than duplicating path
logic in YAML.

## Research Decisions

1. Keep `actions/setup-node`'s pnpm store cache. It safely avoids package
   downloads while retaining a lockfile-verified install; caching `node_modules`
   would couple jobs to fragile filesystem state.
2. Use Docker BuildKit's GitHub Actions backend with `mode=max`, separate scopes
   per image target, and separate trust owners. Pull requests read and write only
   their PR scope; trusted main/release work never imports PR scopes.
3. Use Vitest's static dependency graph for supported source changes and direct
   test selection for changed or explicitly consuming test files. Broad tooling,
   generated-contract, dependency, and unknown executable changes force a full
   relevant suite.
4. Use an explicit Playwright ownership map, not Playwright's heuristic changed
   mode, because E2E journeys depend on runtime routes and services that static
   imports cannot fully represent.
5. Represent empty selections as successful no-op executions in required jobs.
   This preserves branch protection and makes the optimization observable.
6. Restrict selective execution to pull requests. Main, release, manual, and
   local pre-push gates are full drift detectors and safety nets.
7. Cancel superseded pull-request runs using a stable PR concurrency group;
   trusted runs are not canceled by unrelated refs.

## Design

1. An `impact` job checks out full history, computes the exact merge-base/head
   change set, validates the policy, writes `test-impact.json`, uploads it, and
   exposes compact outputs for downstream matrix construction.
2. Unit, integration, and contract jobs remain required. Each downloads the
   plan and runs either a full group, the direct/related affected subset, or an
   explicit successful no-op.
3. The E2E job uses a dynamic matrix containing the selected browser/viewport
   variants. An empty plan produces one `{ "project": "none" }` entry so the
   required job remains present.
4. API and web image builds use BuildKit caches scoped by target and trust owner.
   Scanning and publication reuse only compatible trusted evidence.
5. The quality gate accepts only successful prerequisite jobs and continues to
   reject missing, canceled, skipped, or failed gates.

## Complexity Tracking

No constitution violations or exceptional complexity are introduced.
