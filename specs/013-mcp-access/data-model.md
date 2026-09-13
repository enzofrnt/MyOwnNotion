# MCP persistence

Migration 0017 adds `mcp_connections`, `mcp_exchange_tokens`, `mcp_mutations` and
allowlists the `mcp` audit actor. No change to content identities or owner count.

Connection IDs are UUIDs; owner/workspace/installation and authorizing device
are references. Scope contains action flags, explicit whole-workspace selection,
branch root IDs and file permission. Access secrets are 256 random bits with
SHA-256 domain-separated digests only. The display label is an encrypted
`mcp.label` protected record. Expiry is 90 days from grant unless explicitly
shortened or acknowledged unlimited; revocation is permanent.

Exchange codes are independently random 256-bit values with digest, expiry and
consumed timestamp. A locked transaction atomically consumes the code, records
the access digest and audits exchange. Only one concurrent exchange succeeds.

`mcp_mutations` binds a mutation ID to a connection, action and target before
canonical submission. Another connection cannot replay or inspect that result.
Canonical guards and MCP audit commit with accepted mutations. The authorizing
device remains the delegated operational actor; connection identity is explicit
in audit. Revoking that device also denies the connection.

Full encrypted backups retain all tables. Restore activation revokes connections
and consumes codes. Portable content exports never include those tables.
