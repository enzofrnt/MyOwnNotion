# Implementation Plan: MCP access

**Branch**: `codex/013-mcp-pre-v1` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary and technical context

Repository-pinned Bun 1.4.2, TypeScript, Fastify, PostgreSQL/Drizzle and official MCP TypeScript SDK
2.0.0. The remote endpoint uses stateless Streamable HTTP with current protocol
support and the SDK's supported legacy handshake compatibility. The SDK owns
JSON-RPC validation and negotiation. Per-request handlers are closed after delivery;
permanent subscriptions are disabled so no stream retains authorization. No
second web server or runtime.

## Constitution check

Passed before implementation: one owner, separate spec, encrypted content and
external keys, Bun only, repository services and canonical guards, explicit
scope, recovery invalidation, automated API/protocol and Playwright journeys.
Canvas sections 26 and 47 move this independent feature before V1. No exemption.

## Design and project structure

- `packages/database/migrations/0017_mcp_access.sql`: connections with JSON scope,
  exchange digest and access digest; only random secret SHA-256 digests persist.
  Labels are sealed via existing protected records; structural IDs/scope remain
  readable. Migration 0016 belongs to the parallel reusable-database feature.
- `apps/api/src/mcp/`: token repository/service, scope checking, canonical tools,
  SDK transport adapter. `routes/mcp.ts` owns owner authorization management.
- Settings panel uses existing authentication gate, CSRF and recent proof.
  Temporary code displayed once; exchange endpoint receives it only in JSON.
- Token principal remains separate from owner cookie principal. MCP cannot call
  owner administration routes. Installation readiness, owner state and external
  key availability are required for exchange and every MCP request.
- Scope membership uses active canonical placements and descendants. Reads
  remove private parent placements and hide links outside scope. Search emits
  only allowed IDs/titles and no paths or aggregate counts from private branches.
- Canonical mutation submission uses acceptedWriteGuards and submitMutation with
  authorization inside the transaction. Scope is checked before idempotent replay.
  Operational page edits use PageOperationService.applyServerCommands, explicit
  expected revision and no fabricated owner device. Audit binds the connection.
- File reads use the existing encrypted file service in bounded offset chunks;
  no direct blob paths or unauthenticated download links are exposed.
- Full restore activation conditionally revokes MCP records so older backups
  without the table remain restorable. Exports remain credential-free.

## Threats and controls

Bearer theft is bounded by scopes, expiry and revocation. Codes/tokens never enter
URLs or logs, responses are no-store, Origins are validated, request bytes and
file chunks are bounded, failures are generic. Each connection is revalidated per
request and at mutation commit. Serialized transactions order revoke and writes.
Assistant content is untrusted input; existing domain validation remains final.
Audit uses fixed action names and opaque IDs, never tool arguments.

The optional configuration-file exchange helper supports Linux and macOS,
whose file permissions it can verify. It refuses other host platforms before
reading a code, creating an output or consuming the one-use exchange. Before
the HTTP call, a newly created exclusive file must be regular, owned by the
current Unix account and grant no group/other access. The MCP HTTP protocol and
owner interface remain available to clients on every platform; Windows clients
use their own private credential storage. Do not promise private Windows files
from a POSIX 0600 creation mode, which does not establish Windows ACLs.

## Validation

Token lifetime/replay/revoke tests; encrypted integration tests for scope,
canonical writes, rotation and restore; real HTTP SDK client discovery/calls;
settings Playwright desktop/narrow journey. Focused tests first, full local gate
at integration branch before push. No production/local-owner databases touched.

## Owner interface design (before UI implementation)

Apply the shared [UI and UX skill](../../.agents/skills/ui-quality/SKILL.md)
during implementation and visual review of this settings panel.

The Security settings panel uses existing Button/Field/AsyncState/ConfirmDialog
primitives and semantic theme tokens. A labelled form has independent action
checkboxes, branch choices (descendants included), explicit whole-workspace and
file choices, 90-day default and acknowledged unlimited duration. Labels and
branch names wrap at 320 px. Loading and failed reads are distinct from an empty
inventory; retry keeps the draft. Mutations are never queued offline.

A recent-authentication refusal offers the existing password/passkey ceremonies
in place, refreshes the app's current session, and leaves authorization for a
subsequent explicit click. Exchange code is React memory only, cleared on expiry,
hide, revocation or unmount. Its copy button uses semantic activation and local
feedback. Instructions show same-origin exchange and MCP endpoints and explain
single-use exchange, dedicated bearer credentials and client compatibility.
Connection cards show full scope, expiry, last use and status; renewing prefills
a new grant and clearly retains the prior connection until separately revoked.
Revocation uses the existing confirmation dialog. Audit names safe operations
and identifies connections without exposing credentials or note content.

Validation adds unit checks for refused grant/draft retention, explicit unlimited
acknowledgement, code lifetime and exact CSRF transport; Playwright performs real
grant/exchange/read/revoke at desktop and 320 px, keyboard activation, both themes,
and refusal recovery. Operating-system passkey ceremonies remain covered by the
existing authentication suite rather than fabricated in the MCP journey.

## Integration verification refinement (T018)

The focused coverage diagnostic identifies missing behavioral evidence across
the MCP boundary. Add scoped recursive-reference redaction and source-immutability
tests, independent action grants, parent/list/search pagination, current-scope
checks before mutation replay and collision with owner mutation identities.
Exercise installation/readiness and inventory expiry/revocation, absent or
consumed exchanges, exact request/exchange rate limits, and CLI network/refused/
malformed responses with private-file cleanup and content-free diagnostics.
Use real SDK/HTTP and encrypted disposable PostgreSQL fixtures for integrated
behavior; pure scope/CLI boundaries may use focused unit tests. Simplify only
provably redundant guards or confirmed defects. Do not exclude executable paths,
fabricate unreachable inputs or relax coverage budgets. Record remaining coverage
and distinguish these focused checks from the required full integration gate.

The CLI cleanup must still run when closing its file fails, including after a
failed flush. A failed command must attempt to remove its newly created private
configuration; cleanup must not print raw filesystem/network diagnostics. T018
includes fault-injected close and combined flush/close regressions on real files.
