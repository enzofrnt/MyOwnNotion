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
- UI tasks T011/T012/T014/T015 remain delegated. Full `checks:local` and final
  convergence run on the integration branch before publishing; no push here.
