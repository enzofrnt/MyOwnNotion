# Data Model: CI Cache and Selective Tests

## ImpactPolicy

Committed declaration of how repository paths affect test suites.

| Field | Type | Meaning |
|-------|------|---------|
| `version` | integer | Policy format version. |
| `nonExecutable` | path rules | Changes proven not to affect executable behavior. |
| `vitestNoImpact` | path rules | Executable/tooling inputs proven not to affect Vitest behavior. |
| `e2eNoImpact` | path rules | Executable/tooling inputs proven not to affect browser journeys. |
| `fullVitest` | path rules | Changes that force all Vitest groups. |
| `fullE2e` | path rules | Changes that force all E2E journeys. |
| `vitestConsumers` | mappings | Non-code or cross-cutting paths and their direct test consumers. |
| `e2eJourneys` | mappings | Each E2E test and the source/config prefixes it owns. |
| `e2eIgnored` | paths | E2E support files that are not journeys and force the complete E2E suite. |
| `e2eProjects` | strings | Every required Playwright browser/viewport project; `none` is reserved. |

Validation invariants:

- All paths are repository-relative and normalized.
- Every committed E2E journey appears exactly once.
- Every declared direct consumer exists.
- A non-executable rule cannot cover source, build, runtime, schema, or test
  configuration paths.
- Unsafe non-executable rules, missing consumers, missing broad support-file
  triggers, duplicate journeys, and an invalid project matrix are rejected.

## ChangeSet

Exact input to impact calculation.

| Field | Type | Meaning |
|-------|------|---------|
| `baseSha` | SHA or null | Merge base for a pull request; null forces a full plan. |
| `headSha` | SHA | Commit being validated. |
| `event` | enum | `pull_request`, `push`, `workflow_dispatch`, or `workflow_call`. |
| `changedPaths` | unique paths | Added, copied, modified, deleted, or renamed paths. |
| `deletedPaths` | unique paths | Deleted paths and old sides of renames; a removed source forces full Vitest because its former static graph is unavailable. |

Renames include both old and new paths so ownership cannot disappear silently.

## ImpactPlan

Machine-readable output consumed by CI jobs.

| Field | Type | Meaning |
|-------|------|---------|
| `version` | integer | Plan contract version. |
| `event` | string | Event used to calculate the plan. |
| `baseSha` / `headSha` | SHA values | Auditable commit boundary. |
| `changedPaths` | path array | Normalized input paths. |
| `deletedPaths` | path array | Removed inputs retained for fail-closed selection and audit. |
| `mode` | enum | `none`, `affected`, or `full`. |
| `vitest.mode` | enum | `none`, `related`, `direct`, `mixed`, or `full`. |
| `vitest.sourceFiles` | path array | Files passed to Vitest dependency analysis. |
| `vitest.testFiles` | path array | Tests selected directly. |
| `vitest.groups` | enum array | `unit`, `integration`, and/or `contract`. |
| `e2e.mode` | enum | `none`, `selected`, or `full`. |
| `e2e.testFiles` | path array | Selected journeys. |
| `e2e.matrix` | project array | Browser/viewport variants, or the `none` sentinel. |
| `cacheScope` | string | Trust owner used for BuildKit cache scopes. |
| `reasons` | strings | Human-readable selection rationale. |
| `unknownPaths` | paths | Inputs that forced conservative fallback. |

State transitions:

```text
event/change set
    → policy validation
    → none | affected | full
    → group selections + E2E matrix
    → required jobs: no-op | selected execution | full execution
```

Any policy validation failure, missing base, unsupported event, or unknown
executable path transitions to `full`.

## CacheScope

Logical BuildKit cache namespace.

| Attribute | Values | Purpose |
|-----------|--------|---------|
| `trust` | `pr`, `main`, `release` | Separates untrusted and trusted producers. |
| `owner` | PR number, branch, or exact SHA | Prevents unrelated writers from sharing a scope. |
| `target` | `api` or `web` | Prevents target cache records from overwriting each other. |
| `compatibility` | Dockerfile/base/tool inputs | BuildKit validates content-addressed reuse. |

Allowed flows:

- PR build → same PR cache only.
- Main build → main cache only.
- Release quality gate → exact release cache.
- Release publication → exact release cache produced for the same commit.

## TestVariant

One Playwright project from the repository configuration. Current values are
`chromium-desktop`, `firefox-desktop`, `webkit-desktop`, `chromium-mobile`, and
`webkit-mobile`. The sentinel `none` represents an explicit successful no-op
and is never passed to Playwright.
