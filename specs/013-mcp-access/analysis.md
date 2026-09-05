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
