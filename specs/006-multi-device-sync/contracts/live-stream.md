# Contract: Live Change Stream

How a device learns that something changed, and how it catches up. Implements
FR-001 to FR-008.

## Subscribing

```
GET /v1/changes/stream
Accept: text/event-stream
Last-Event-ID: 41            (optional — where this device got to)
→ 200 OK
  Content-Type: text/event-stream
  Cache-Control: no-store
  X-MyOwnNotion-Protocol: 1
```

Events carry the stream position and nothing else:

```
id: 42
event: advanced
data: {"cursor":"42"}
```

**The event is a position, not a payload.** The device then reads
`/v1/changes?after=<its own cursor>` exactly as it does today. That keeps one
content path: a pushed payload would bypass the sealed-envelope resolution and
the protocol check that the pull path performs, and a device applying it would
hold content that passed neither.

It also makes redelivery harmless (FR-007). A position is a fact rather than an
operation, so receiving `42` twice is receiving it once.

## Reconnecting and catching up

The browser reconnects on its own and sends `Last-Event-ID`. The server uses it
only to decide what to say next; the device's own cursor remains the authority on
what it has *applied*, because an event can arrive and the fetch that follows it
can fail.

That separation is deliberate: conflating "told about" with "applied" is how an
event gets lost (FR-005). The two are allowed to disagree, and the cursor wins.

A first connection with no `Last-Event-ID` receives one `advanced` event with the
current position, so a device that missed everything behaves exactly like a
device that missed one thing.

### A position that can no longer be served

When the requested position is older than the retained window, the stream says
so rather than sending events that skip a gap:

```
event: compacted
data: {"cursor":"512"}
```

The device rebuilds from `/v1/snapshots/current` and keeps its outbox — the
existing behaviour of the pull path, reached the same way. Silently resuming from
the oldest retained change would leave the device permanently missing whatever
fell in the gap, which is the failure FR-006 exists to prevent.

## Heartbeat

A comment line every 20 seconds:

```
: keep-alive
```

Not decoration. An idle SSE connection is indistinguishable from a dead one to
every proxy between the device and the server, and a connection a proxy has
quietly dropped is a device that believes it is live and hears nothing. The
heartbeat is what turns that into a reconnection.

## Delivery target

FR-002 asks for under two seconds in 95% of cases. The path is: mutation commits
→ change row appended → subscribers notified → device fetches. Nothing here
polls, so the latency is one notification plus one fetch.

## Revocation

A revoked device's stream is closed and refused on reconnect:

```
→ 401 Unauthorized
  { "code": "device.revoked", "title": "This device's access was withdrawn" }
```

Enforced by the server rather than by asking the client to stop (FR-021). The
client's own reaction — saying so, ceasing to write — is a courtesy that makes
the situation legible, never the mechanism.

## Protocol version

`X-MyOwnNotion-Protocol` is on every response, not only this one, so a client
cannot pass a handshake and drift. A server upgraded under a long-lived stream
changes the header, and the next write is judged against the new value.

| Client version | Result |
| --- | --- |
| At or above `MINIMUM_WRITE_VERSION` | Reads and writes |
| Between the read and write minimums | Reads only; writes refused with what to update |
| Below `MINIMUM_READ_VERSION` | Refused, with what to update |

Read-only rather than locked out wherever reads are safe (FR-020): an owner who
can still read can still copy their work out of a device that is behind.
