# Contract: Realtime page synchronization

## Endpoint and negotiation

- Browser endpoint: `GET /v1/page-sync/socket`
- Scheme: `wss` when the public origin is HTTPS, `ws` only for the named
  loopback-development HTTP exception.
- Cookies: same-origin session cookie sent by the browser during upgrade.
- Required handshake header: `Origin`, exactly equal to
  `MYOWNNOTION_PUBLIC_ORIGIN` after origin normalization.
- Maximum decoded WebSocket message: 2 MiB.
- `hello` deadline: 5 seconds after upgrade.
- Maximum concurrent requests per connection: 8, and 1 per `pageId`.
- Heartbeat: `ping` every 20 seconds; close after 60 seconds without valid
  traffic or `pong`.

The endpoint is registered only when the security layer and page-operation
services are available. An installation harness without authentication does not
gain an anonymous synchronization socket.

## Versioning

Two versions are negotiated independently:

- `realtimeProtocolVersion = 1`: envelopes, session and close semantics;
- `pageOperationProtocolVersion = 3`: existing page request/response payloads.

An unsupported realtime version closes with `4406`. An unsupported page
operation version returns `needs-update` in the `refused` message and then
closes with `4406`. No content message is accepted under a partially compatible
combination.

## Client messages

### `hello`

First and only first message while `awaiting-hello`:

~~~json
{
  "type": "hello",
  "requestId": "019...",
  "realtimeProtocolVersion": 1,
  "pageOperationProtocolVersion": 3,
  "csrfToken": "memory-only-token"
}
~~~

Rules:

- `csrfToken` is compared in constant time with the token derived for the
  authenticated session.
- It is never echoed, persisted or logged.
- The server rechecks that the device exists and is authorized before `ready`.
- A second `hello` is a protocol violation.

### `sync`

~~~json
{
  "type": "sync",
  "requestId": "019...",
  "pageId": "019...",
  "request": {
    "mode": "active",
    "requestId": "019...",
    "operationalVersion": 1,
    "persistedVersionVector": "...",
    "knownServerPageSequence": 42,
    "updates": [],
    "maxRemoteBytes": 1048576
  }
}
~~~

Rules:

- Envelope `requestId` MUST equal `request.requestId`.
- `pageId` is route context for the existing `PageSyncRequestDto`.
- Modes `active`, `empty` and `legacy-branch` use the same parser and service
  selection as the HTTP route.
- Unknown fields, invalid base64, duplicate update IDs or contract limits are
  refused before service invocation.
- The same request ID MAY be retried on a later connection. Idempotence comes
  from immutable update/transaction IDs, not from an in-memory response cache.

### `ping` and `pong`

~~~json
{ "type": "ping", "nonce": "019..." }
~~~

~~~json
{ "type": "pong", "nonce": "019..." }
~~~

The nonce is opaque and bounded. Either side answers a valid `ping` with the
same nonce. Heartbeats carry no clock or page state and cannot advance a sync
frontier.

## Server messages

### `ready`

~~~json
{
  "type": "ready",
  "requestId": "019...",
  "connectionId": "019...",
  "realtimeProtocolVersion": 1,
  "pageOperationProtocolVersion": 3,
  "heartbeatIntervalMs": 20000,
  "requestTimeoutMs": 30000,
  "maxMessageBytes": 2097152,
  "maxInFlight": 8
}
~~~

`ready` means only that the channel is authorized. It does not mean any local
page or file is synchronized. Receiving it triggers client catch-up.

### `sync-result`

~~~json
{
  "type": "sync-result",
  "requestId": "019...",
  "pageId": "019...",
  "response": { "mode": "active", "requestId": "019...", "pageId": "019..." }
}
~~~

The full `response` MUST pass `PageSyncResponseSchema`. It is sent only after
the corresponding service transaction has returned successfully. If socket
serialization or send fails after commit, no compensation is attempted; the
client retries and receives `repeated` receipts.

### `sync-problem`

~~~json
{
  "type": "sync-problem",
  "requestId": "019...",
  "pageId": "019...",
  "offline": false,
  "retryable": false,
  "problem": {
    "code": "page-operations.device-revoked",
    "message": "This device is no longer authorized."
  }
}
~~~

The problem uses safe existing page-operation codes where possible. It never
contains thrown messages, SQL details, payloads or keys. A request-scoped
problem does not close a healthy session unless it proves the whole session is
invalid (`device-revoked`, authentication, protocol).

### `page-advanced`

~~~json
{
  "type": "page-advanced",
  "pageId": "019...",
  "latestPageSequence": 43
}
~~~

Rules:

- Published only after the page write transaction committed.
- May reach the author as well as every other session; each client ignores a
  sequence its durable state already dominates.
- Does not contain update bytes or change local state directly.
- Duplicate and out-of-order announcements are valid.
- The client coalesces announcements per page and asks its reconciler to catch
  up when the announced sequence exceeds the local durable sequence.

### `refused`

Used only before `ready` when the socket can still deliver a safe reason:

~~~json
{
  "type": "refused",
  "requestId": "019...",
  "code": "csrf_validation_failed",
  "message": "The authenticated session must be refreshed."
}
~~~

The server sends it best-effort, then closes. The client treats missing
`refused` plus a close code conservatively.

## Close codes

| Code | Meaning | Client behavior |
| --- | --- | --- |
| `1000` | Normal lifecycle close | Stop if disposal was requested, otherwise reconnect |
| `1001` | Server shutdown | Reject in-flight as offline and reconnect with jitter |
| `1009` | Message too large | Keep local work, expose safe blocked reason |
| `4400` | Invalid message or state | Do not replay that malformed request automatically |
| `4401` | Authentication required/expired | Refresh session, then reconnect |
| `4403` | Origin, CSRF or device refused | Stop; map device revocation separately |
| `4406` | Protocol update required | Stop and display update requirement |
| `4408` | Hello/liveness timeout | Reconnect with backoff |
| `4409` | Duplicate request/page already in flight | Retry only after the previous call settles |
| `4429` | Rate or concurrency limit | Keep durable queue and retry with server-directed delay |
| `4500` | Internal failure | Keep durable queue and reconnect; log safe correlation ID |

## Server processing sequence

~~~text
message parsed
  → session/page/request limits checked
  → device authorization prechecked
  → existing page service invoked
  → device row locked and revalidated inside the transaction
  → PostgreSQL transaction commits
  → page-advanced published independently of the author response
  → page result returned
  → sync-result sent to author
~~~

If commit fails, neither publication nor response occurs. If publication or
response delivery fails after commit, no rollback is attempted: reconnect and
frontier catch-up repair the lost signal. Search refresh remains best effort
after canonical commit and cannot turn a committed page update into a failed
sync response.

## Client reconnect and fallback

1. Connect immediately when an authenticated CSRF token is available.
2. On transient failure, schedule full-jitter delay in
   `[0, min(500 × 2^attempt, 5000)]` milliseconds.
3. Reset the attempt counter after a stable `ready` period.
4. On `online`, visible wake or a new local durable update, accelerate the next
   attempt without opening a second socket.
5. Reject every in-flight transport promise on close; do not delete or clone
   IndexedDB updates.
6. If the socket is not ready after the bounded connection window, a sync call
   MAY use HTTP. That call owns the exchange until it settles; the newly-ready
   socket cannot issue the same invocation in parallel.
7. On `ready`, ask the service to reconcile every queued, legacy and mounted
   page. A periodic low-frequency safety sweep covers a notification lost while
   the socket appeared healthy.

## Security and observability

- Validate exact public origin before upgrade; reject missing origin except in
  explicit non-browser contract tests.
- Authenticate cookie through the existing request context.
- Validate CSRF from `hello`; never URL or subprotocol.
- Recheck revocation before messages and on heartbeat.
- Bound message bytes, JSON depth through schemas, requests in flight and
  message rate.
- Structured logs MAY include connection/correlation/device IDs, message type,
  byte count, duration and safe code.
- Logs MUST NOT include page content, updates, version vectors, ciphertext,
  CSRF, cookies, session IDs, file bytes or keys.

## Proxy contract

The official Web nginx location forwards HTTP/1.1 upgrade headers and disables
response buffering. Its read timeout exceeds 60 seconds. The Vite development
proxy sets `ws: true` for `/v1`. The external HTTPS example preserves `Host`,
`X-Forwarded-Proto`, `Upgrade` and `Connection`; the API continues to trust
forwarded headers only from configured proxy CIDRs.
