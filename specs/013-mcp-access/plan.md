# Implementation Plan: MCP access

**Branch**: `codex/013-mcp-pre-v1` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

## Summary and technical context

Bun 1.4, TypeScript, Fastify, PostgreSQL/Drizzle and official MCP TypeScript SDK
2.0.0. The remote endpoint uses stateless Streamable HTTP with current protocol
support and the SDK's supported legacy handshake compatibility. The SDK owns
JSON-RPC validation and negotiation. No second web server or runtime.

## Constitution check

Passed before implementation: one owner, separate spec, encrypted content and
external keys, Bun only, repository services and canonical guards, explicit
scope, recovery invalidation, automated API/protocol and Playwright journeys.
Canvas sections 26 and 47 move this independent feature before V1. No exemption.

## Design and project structure

- `packages/database/migrations/0017_mcp_access.sql`: connections with JSON scope,
  exchange digest and access digest; only random secret SHA-256 digests persist.
  Labels are sealed via existing protected records; structural IDs/scope remain
  readable. Migration0016 belongs to the parallel reusable-database feature.
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

## Validation

Token lifetime/replay/revoke tests; encrypted integration tests for scope,
canonical writes, rotation and restore; real HTTP SDK client discovery/calls;
settings Playwright desktop/narrow journey. Focused tests first, full local gate
at integration branch before push. No production/local-owner databases touched.
