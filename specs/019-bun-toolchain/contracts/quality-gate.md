# Contract: Bun quality and delivery gate

## Canonical local gate

`bun run checks:local` MUST execute, in the maintained order and with blocking
failure propagation:

1. toolchain policy;
2. shell policy;
3. formatting check;
4. lint/static analysis;
5. strict TypeScript;
6. coverage suite;
7. performance budgets;
8. database integration and migration suites;
9. API/workspace contracts;
10. complete bounded Playwright matrix;
11. production builds;
12. multiarchitecture image builds and runtime smoke;
13. dependency audit;
14. secret scan;
15. static security analysis;
16. license policy;
17. Compose/environment validation.

Independent focused families MAY be run in parallel for feedback. PostgreSQL
fixtures and full browser stacks MUST retain their documented isolation. The
default local E2E scheduler MUST start at most two stacks concurrently on a
constrained host.

## CI setup contract

Every job executing repository TypeScript/JavaScript MUST:

1. check out the exact candidate;
2. install Bun 1.4.0 through the repository's composite setup action or the
   identical pinned official action when no dependency install is needed;
3. restore only a Bun cache compatible with runner OS, architecture and
   `bun.lock` hash;
4. execute `bun ci` before dependency-backed commands;
5. call the same named root script used locally.

No such job may use `actions/setup-node`, `pnpm/action-setup`, npm, Yarn, pnpm
or a mutable Bun version selector.

## Impact-plan command contract

The deterministic impact planner keeps the same modes, groups, test files,
browser matrix and cache scopes. Its generated commands become:

| Group | Full command |
| --- | --- |
| unit | `bun run test:coverage` |
| integration | `bun run test:integration`, then `bun run db:test-migrations` |
| contract | `bun run test:contract` |
| performance | `bun run test:performance` |

Related/direct selections MUST call Vitest through Bun. A no-impact group is an
explicit successful no-op; an unknown executable path expands to the existing
safe full plan.

## Blocking job inventory

The aggregate `quality-gate` MUST continue to require:

- `impact`
- `install`
- `lint`
- `shell`
- `typecheck`
- `unit`
- `performance`
- `integration`
- `reference-backups`
- `contract`
- `e2e`
- `build`
- `build-images`
- `dependency-vulnerability-audit`
- `secret-scan`
- `static-security-analysis`
- `container-vulnerability-scan`
- `license-policy`

Only `success` is accepted. Failed, skipped, cancelled, missing or stale jobs
block the aggregate. Publication jobs depend on this aggregate and compare its
candidate SHA to their own exact commit.

## Security evidence

| Gate | Bun command/tool | Required artifact |
| --- | --- | --- |
| dependency audit | `bun audit --prod --audit-level=high --json` | `dependency-audit.json` |
| secrets | existing scanner run by Bun | `secret-scan.sarif` |
| static source | existing scanner run by Bun | `static-security.sarif` |
| licenses | `bun pm licenses --prod --json` + existing allowlist | `license-policy.json` |
| containers | existing Trivy jobs | `container-scan.sarif` |
| images | existing build evidence | `image-build.json` / published digests |

Changing the command output format MAY require an adapter. It MUST NOT weaken
severity, allowlist, fixable-vulnerability or artifact requirements.

## Pull request and publication

- A work-branch push runs no required CI.
- The pull request is the first automated gate and MUST pass on its latest
  candidate.
- The branch is pushed only after `bun run checks:local` succeeds.
- A push to `main` publishes commit-addressable API/Web images only after the
  same aggregate succeeds.
- A release tag proves the gate ran on the exact tag commit before publishing
  versioned artifacts.

## Acceptance probes

- Contract-test the setup action SHA, exact Bun version, cache key and `bun ci`.
- Contract-test the complete job inventory and publication dependencies.
- Generate full, affected and no-impact plans and compare selected tests to the
  pre-migration behavior.
- Force one failure in each gate family and prove the aggregate fails.
- Search all active workflow/script/documentation surfaces for historical
  executable commands and assert zero findings.
