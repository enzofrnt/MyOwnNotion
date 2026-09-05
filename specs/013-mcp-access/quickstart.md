# Validation and setup

Follow [the owner setup guide](../../docs/mcp.md). Open security settings, create
a restricted connection, exchange the temporary code, then use an official SDK
client with its bearer header against the installation's `/mcp` endpoint.

Focused checks (disposable databases only):

```sh
PATH=/opt/homebrew/opt/libpq/bin:$PATH TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/myownnotion bun run --bun vitest run --project api-contract apps/api/tests/mcp-access.integration.spec.ts apps/api/tests/full-restore.integration.spec.ts --maxWorkers=2
bun run --filter @myownnotion/api typecheck
```

Check native MCP discovery, content mutations through ordinary API readback,
protected SQL, branch/file denial, actual full backup/restore activation and
new configuration file permissions. Desktop/narrow settings journeys are owned
by the feature's Playwright suite. The integration branch runs all local gates
before any push; this isolated implementation does not push or merge.

## Backend evidence — 2026-09-05

- MCP integration: 12 tests passed using the official SDK client over real HTTP.
  Current metadata/protocol validation, legacy handshake, denied subscriptions,
  malformed JSON, scope and file isolation, protected canonical mutations,
  operational and legacy page edits, stale/rotation refusal, token lifecycle,
  recent-auth/CSRF and private CLI configuration are covered.
- Full restore: 13 tests passed, including actual native dump/restore and old
  bearer/code refusal after activation; old schemas remain supported.
- Shared canonical regressions: 11 tests passed across mutation contracts,
  page activation and operational page service.
- API typecheck, production Bun build, compiled MCP CLI help and focused Biome
  checks passed. The API bundle emits the dedicated exchange CLI.
- UI tasks T011/T012/T014/T015 are complete; see [UI validation](ui-validation.md).
  Full `checks:local` remains the integration branch gate before publishing;
  no push here.

## Owner UI evidence — 2026-09-05

19 focused Web tests and 15 real browser journeys passed on the five browser
profiles. The journeys include grant, exchange once, allowed and denied reads,
revocation, explicit renewal, network refusal, secret memory lifetime and real
password confirmation after stale authentication. Use the official matrix
against a disposable database server, with two projects maximum:

```sh
DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/postgres MYOWNNOTION_E2E_API_PORT_BASE=4101 MYOWNNOTION_E2E_WEB_PORT_BASE=6273 MYOWNNOTION_E2E_JOBS=2 bun scripts/e2e/run-local-matrix.ts tests/e2e/mcp-access.spec.ts --retries=0
```

This direct runner creates and removes isolated databases without starting the
owner's local Docker development stack. Full evidence and limitations are in
[ui-validation.md](ui-validation.md).

## MCP boundary evidence — T018, 2026-09-05

45 focused tests pass: 21 real HTTP/SDK integration cases, 18 private CLI cases
and six pure scope cases. Additional evidence covers nested link/file/database
reference redaction without source mutation; independently granted actions;
parent/list/search pagination; rename/trash replay and owner mutation collisions;
installation and inventory availability/expiry; exact request/exchange budgets;
file EOF; malformed protected content; stale revocation; deterministic audit
ordering and safe service errors. CLI failures cover network, HTTP, JSON,
credential shape, flush and close, including combined flush/close failure.

Two close-failure cases failed before the CLI correction: a reported failed
command left a newly created private file containing credentials. The finalizer
now attempts cleanup even when close fails. Its success/private permissions and
all failure-cleanup cases pass. These are injected filesystem failures on actual
POSIX files; they make no native Windows permission claim.

```sh
TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/postgres bun run --bun vitest run --project api-contract apps/api/tests/mcp-access.integration.spec.ts apps/api/tests/mcp-exchange-cli.spec.ts apps/api/tests/mcp-scope.spec.ts --maxWorkers=2 --coverage --coverage.include='apps/api/src/mcp/**/*.ts' --coverage.include='apps/api/src/routes/mcp.ts' --coverage.reporter=json --coverage.reporter=text --coverage.reportsDirectory=/tmp/mon-mcp-t018-coverage
bun run --filter @myownnotion/api typecheck
bun run biome check apps/api/src/mcp/exchange-cli.ts apps/api/tests/mcp-access.integration.spec.ts apps/api/tests/mcp-exchange-cli.spec.ts apps/api/tests/mcp-scope.spec.ts
```

The final focused run completed in 19.54 s. Evidence:
`/tmp/mon-mcp-t018-coverage.log`,
`/tmp/mon-mcp-t018-coverage/coverage-final.json`,
`/tmp/mon-mcp-t018-types.log`; the two-case pre-fix reproduction is
`/tmp/mon-mcp-t018-cli-repro.log`.

The six measured MCP modules improved from 90.72% statements / 77.66% branches
(37 statements and 65 branches uncovered) to 97.76% / 95.90%
(9 statements and 12 branches uncovered). Scope and HTTP transport are at 100%;
all tool and management-route lines are exercised. Function coverage remains
79/80: the standalone CLI stdout callback runs in an uninstrumented child process.
These are focused module numbers, not the combined application's coverage gate.
No coverage exclusions, debt budgets or timeouts changed. T016 still requires
full local gates on the combined tree, then CI/review and delivery.
