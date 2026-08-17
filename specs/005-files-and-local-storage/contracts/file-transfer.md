# Contract: File Transfer

How bytes get in, how an interrupted transfer resumes, and when a file may be
called synchronized. Implements FR-006 to FR-009.

## Resumable upload (tus 1.0)

Three requests, and the invariant that makes them safe: **the server's offset
is the only offset**. A client that believes it sent more than the server
received is wrong by definition, and asks rather than assumes.

### Create

```
POST /v1/uploads
Upload-Length: <total bytes>
Upload-Metadata: filename <base64>, mediaType <base64>
→ 201 Created
  Location: /v1/uploads/{id}
```

Refused before any byte is accepted when `Upload-Length` exceeds the configured
maximum:

```
→ 413 Payload Too Large
  { "code": "file.too-large", "limitBytes": 2147483648, "declaredBytes": … }
```

The limit and the reason are both in the body, because FR-009 requires the
owner to be told *what* the limit is, not merely that one was hit. The client
holds the draft; nothing about this response discards it.

### Resume

```
HEAD /v1/uploads/{id}
→ 200 OK
  Upload-Offset: <bytes the server actually has>
  Upload-Length: <total>
```

The client seeks to `Upload-Offset` and continues. This is the whole of the
resume logic, and the reason the client keeps no byte-count of its own.

### Send

```
PATCH /v1/uploads/{id}
Content-Type: application/offset+octet-stream
Upload-Offset: <where this chunk starts>
→ 204 No Content
  Upload-Offset: <new offset>
```

A `PATCH` whose `Upload-Offset` disagrees with the server is refused with
`409 Conflict` rather than accepted at the server's offset. Silently correcting
it would write the client's bytes to the wrong place, producing a file that
completes successfully and is corrupt.

### Complete

When `received_length` reaches `declared_length` the server hashes the
accumulated bytes and finishes in one transaction:

1. digest matched against `file_contents` — a resumed upload of content already
   held deduplicates like any other;
2. `file_contents.verified_at` set;
3. `logical_file` and its placement created.

```
→ 201 Created
  { "itemId": …, "contentId": …, "byteLength": …, "verified": true }
```

**Before this point no item exists.** A partial upload has no placement and
appears in no listing, so "a partial upload never appears as a complete file"
is a property of the shape rather than a check.

### Expiry

An upload untouched past `expires_at` is reclaimed with its partial bytes.
`HEAD` on it answers `410 Gone`, which the client presents as "this transfer
expired, start again" rather than as a failure it could retry forever.

## Integrity and sync state

A file is reported synchronized only when `verified_at` is set — the server
computed the digest over what it stored, not what the client claimed
(FR-007). A client-supplied checksum is accepted as an early-mismatch signal
and never as proof.

States an owner may see for a file, mirroring the save states of feature 003:

| State | Means |
| --- | --- |
| `uploading` | Bytes in flight; offset known and resumable. |
| `verifying` | All bytes received, digest being computed. |
| `synchronized` | `verified_at` set. |
| `blocked` | Refused; the reason and the limit are stated. |

## Download

```
GET /v1/files/{itemId}/content
→ 200 OK
  Content-Type: <stored media type>
  Content-Disposition: attachment; filename="…"
  X-Content-Type-Options: nosniff
  Content-Security-Policy: default-src 'none'; sandbox
```

Every header is load-bearing (research decision 3): `attachment` stops inline
rendering, `nosniff` stops reinterpretation as something executable, and the
policy denies the response any capability at all. Preview fetches the same
bytes and renders them inside a sandboxed frame; the download path never
becomes a rendering path.

`Range` requests are supported so a large PDF previews progressively.
