# Pre-implementation consistency analysis

2026-09-05: No blocking inconsistency. FR-001–003 map to T004–006/T011;
FR-004–008 map to T007–010; FR-009 to T006; FR-010–011 to T011–012.
All stories are covered. The release change preserves separate specs and the
existing settings authorization requirement. Source precedence was checked.

## Configuration helper permission boundary — T017

Independent review identified that a POSIX `0600` creation mode does not prove
private Windows ACLs. The optional helper now explicitly supports Linux/macOS,
refuses other platforms before file access or code exchange, and verifies the
new output handle's regular-file type, current-account ownership and absence of
group/other permissions before receiving a credential. No credential is received
or retained on refusal. The HTTP exchange and settings interface remain usable
by Windows clients. This clarification is consistent with FR-005/FR-008 and
recorded in spec/plan/setup documentation.

Seven focused cases verify two platform refusals, unsafe mode/owner/type and
successful Unix output. The five missing refusals fail against the prior code,
then all seven pass after correction. API types pass. These are simulated host
and filesystem failure boundaries, not a native Windows private-file claim.
Logs: `/tmp/mon-mcp-private-config-baseline.log`,
`/tmp/mon-mcp-private-config-fixed.log`, `/tmp/mon-mcp-private-config-types.log`.
Full integrated gates and PR/main delivery remain T016.

The real official HTTP client suite also passes with the corrected helper:
19 cases across the two MCP integration/CLI suites, including actual exchange,
private configuration creation, expiry/scope/revocation and operational edits.
Log: `/tmp/mon-mcp-private-config-integrated.log`.

## Boundary verification and cleanup — T018

The refinement remains within FR-002–FR-009 and was recorded in plan/tasks before
implementation. The only production change is the CLI close/cleanup correction
in `apps/api/src/mcp/exchange-cli.ts`: failure of `close()` previously prevented
cleanup, including after a failed flush. Two real-file fault-injection cases
reproduced retained private credentials; both now pass with all 45 focused tests.
API types and focused Biome pass. Full integration and delivery remain T016.
See [the reproducible evidence](quickstart.md#mcp-boundary-evidence--t018-2026-09-05).

T018 reduced uncovered MCP branches from 65 to 12 without exclusions, artificial
unreachable inputs or relaxed budgets. Remaining branches are explicitly retained:

- `access-service.ts:49`: the synthetic owner ID fallback; SQL's
  `installations_counts_check` guarantees an owner on a ready installation.
- `exchange-cli.ts:130`: standalone process entry, already exercised through a
  real child CLI but outside this Istanbul worker's instrumentation.
- `tools.ts:169,170,221`: defensive result/cursor fallbacks. Canonical
  `submitMutation`/`replayResult` supply a problem on rejection and revision IDs
  on acceptance; positive pagination limits ensure a selected last item.
- `tools.ts:234,236,409,421,424`: defensive missing-record/resolved-document
  checks. Authorization and reads share serializable transactions;
  `resolveProtectedContent` preserves the input cardinality. These guards remain
  useful at typed storage boundaries and were not replaced with type assertions.
- `routes/mcp.ts:22,59`: inventory/audit owner refusals are already enforced by
  the global authenticated HTTP preHandler before reaching the route. Actual
  anonymous requests are tested and refused.

These figures do not establish whether the combined coverage gate passes; other
features and their cross-module evidence must be measured together. No gate or
main/CI result is claimed here. Hierarchy scope also remains unchanged by 026:
embedding a linked source grants no access to independent pages; the owner guide
now explains that boundary.
