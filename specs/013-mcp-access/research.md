# Research

Verified 2026-09-05 against primary sources:

- [MCP Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): current stateless protocol, request metadata and header validation; use SDK rather than hand-built JSON-RPC.
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): published `@modelcontextprotocol/server` 2.0.0 supports Web-standard request/response transport on Bun. Its dependencies are core and Zod, avoiding a second server framework.
- [SDK legacy routing](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/README.md): supported compatibility path for 2025-era clients.

Authorization is explicit dedicated bearer provisioning, not a claim of generic
OAuth interoperability. Credentials have high entropy and irreversible digests;
labels use the application encryption boundary. MCP content access is server-only
and does not change local-first editing or owner identity.
