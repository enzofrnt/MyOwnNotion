# MCP and authorization contract

- `POST /mcp`: official MCP SDK2 transport, current2026-07-28 metadata and
  supported2025 stateless handshake. `Authorization: Bearer` is mandatory on
  every request; owner cookies grant no MCP access. GET/DELETE return405 after
  authentication. Foreign browser Origins are refused; no server sessions or
  subscription streams are created. Application body limit1MiB.
- `POST /mcp/exchange {code}`: one-use exchange; no owner cookie is required;
  result `{accessToken, tokenType:"Bearer", expiresAt}`. No-store response;
  invalid/expired/consumed/revoked code401, foreign Origin403, rate limit429.
- `GET /v1/mcp/connections`: owner inventory, labels decrypted, no secret hashes.
- `POST /v1/mcp/connections`: `McpGrant` contract, recent authentication and CSRF.
  Result `McpGrantResult` displays the temporary code once.
- `POST /v1/mcp/connections/:id/revoke`: recent auth/CSRF, idempotent204.
- `GET /v1/mcp/audit`: owner-only recent safe connection events.

Tools: `list_items`, `read_item`, `search`, `create_item`, `rename_item`,
`edit_page`, `trash_item`, `read_file`. Discovery only advertises granted actions;
files require their separate grant. Search takes one permitted branch root unless
whole workspace is authorized and never emits private path metadata.
`read_item` returns the canonical revision and document digest needed by
`edit_page`. Edits are paragraph insertion, text range replacement and block
deletion, through existing operational services (safe lazy activation for legacy
pages). All mutation identities are stable UUIDs supplied by the client.
`trash_item` is reversible and refuses branches with excluded files.
`read_file` returns bounded base64 chunks with `nextOffset`, maximum65536 bytes.

Errors inside tools use `isError:true` and fixed safe codes; no raw exception,
query, private parent or inaccessible identifier detail is returned.
