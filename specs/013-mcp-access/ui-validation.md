# Owner interface validation

Date: 2026-09-05. UI work follows backend commit d3f01824 on the isolated
`codex/013-mcp-pre-v1` branch. No push, PR or merge from this worktree.

## Design and convergence

The UI plan was appended before source implementation, following the feature's
existing specify → plan → tasks → analyze sequence and the repository UI skill.
FR-001, FR-003, FR-004, FR-010 and FR-011 map to the settings panel and typed
SecurityApi boundary. The remaining security/protocol requirements retain the
backend evidence in quickstart.md.

The panel offers explicit scope, 90-day default/acknowledged unlimited duration,
filtered branch selection without losing hidden selections, separate file access,
full inventory state, intentional renewal, revocation confirmation and safe audit.
A real recent-authentication refusal opens existing credential ceremonies without
losing the grant draft. Updating the app session after success avoids stale
current-session identity; grant/revoke still require a separate explicit action.
Codes live only in memory and disappear on unmount, hide, expiry, consumption
refresh or revocation. Late clipboard results cannot resurrect dismissed feedback.

Browser convergence found a shared fixture gap: canonical reset cleared protected
labels while keeping MCP connection rows. The reset now deletes MCP mutations,
connections (exchange codes cascade under migration 0017), and MCP audit events
before clearing envelopes. No production data-reset behavior changed.

## Focused evidence

- 19 tests passed: nine interactive panel cases, two transport tests and eight
  existing device presentation regressions. These cover independent scope,
  unlimited acknowledgement, errors/retries, recent proof, expiry/copy, renewal,
  revoke, pending operation deduplication, leaving settings and audit outcomes.
- Web and root E2E TypeScript checks passed.
- Biome changed-file checks passed; final diff is checked before local commit.
- All 15 browser journeys passed across Chromium/Firefox/WebKit desktop and
  Chromium/WebKit mobile, with two projects at most and retries disabled
  (50 seconds). Log: `/private/tmp/mon-mcp-ui-final.log`.
- Production and E2E Web builds passed with Bun 1.4.0, the version pinned when
  this isolated UI evidence was recorded. Integrated delivery uses the
  repository's current pinned Bun 1.4.2 runtime. The ordinary build emitted
  25 outputs and precached 17 assets.
- Static security analysis and secret scanning passed with zero findings.
- Final visual inspection covers light desktop, dark 320 px, and the code
  instructions (the temporary secret is masked in the saved capture). The UI
  confines long text, uses full-width fields and keeps actions in their cards.
  A follow-up narrow check verifies the final instruction spacing/list markers.
  Captures live under `/private/tmp/mon-mcp-ui-results/<project>/`.


Browser journeys use real API grant, single-use exchange, Streamable HTTP read,
branch denial, revoke and a genuine stale-session/password confirmation. Simulated
network and 428 refusals separately verify retained inputs; no queued writes are
invented. Temporary browser test databases are isolated on PostgreSQL 55433.
The OS passkey ceremony is not automated by the MCP-specific suite; the existing
authentication suite owns that coverage.

## Delivery boundary

The integration owner must run the complete `docs/development.md` gate inventory,
including `bun run checks:local`, before any push. This focused report is not a
full-gate or publication claim.

## Final convergence

T011/T014 implement the remaining settings requirements and T012/T015 provide
SC-003 evidence. Existing backend evidence plus these owner journeys cover the
feature's 11 requirements and three success criteria. No missing implementation
was identified. T016 is the explicit remaining integration/delivery gate.
