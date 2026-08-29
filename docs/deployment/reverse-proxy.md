# Putting MyOwnNotion behind HTTPS

This stack **does not terminate TLS**. It publishes plain HTTP on the loopback
interface and expects a reverse proxy in front of it. That is a deliberate
boundary, not an unfinished feature, and this page explains it and then gives
three working configurations.

The API runtime is Bun and the page-sync connection uses Bun's built-in `ws`
compatibility module behind Fastify. This changes neither the public URL nor
the proxy contract below: the browser still reaches one same-origin WebSocket
through the Web container.

## Why the stack has no certificate

Three reasons, in order of how much they would cost you if we got them wrong.

**Certificates are the operator's, not the application's.** You already have a
way of getting them — a proxy that talks to Let's Encrypt, a corporate CA, a
tunnel from a provider. An application that insisted on managing its own would
need your DNS credentials, your renewal schedule, and a port 80 nobody else is
using.

**Anything the stack chose would be wrong somewhere.** A self-signed
certificate produces a browser warning that owners learn to click through,
which is worse than no certificate at all. A Let's Encrypt client baked into
the image fails on the machines that have no public DNS name, which is a great
many self-hosted installations.

**One less thing in the blast radius.** The container that holds your notes
does not also hold a private key that identifies your domain.

## Why the app still insists on HTTPS

The security configuration refuses to start in production unless
`MYOWNNOTION_PUBLIC_ORIGIN` is an `https://` URL. Three things depend on it and
none of them degrades gracefully:

- **`__Host-` cookies.** The session cookie carries the `__Host-` prefix, which
  browsers only accept over HTTPS. There is no partial version of this.
- **Passkeys.** WebAuthn requires a secure context. `localhost` is treated as
  one by browsers; a bare IP address such as `127.0.0.1` is **not**, and
  passkey registration will simply not be offered.
- **The origin checks.** CSRF and cookie policy compare the request's origin
  against this value. An origin that lies about its scheme makes both checks
  meaningless.

For local experiments there is `MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1`, which
issues a separate, plainly-named `mn_dev_session` cookie over loopback HTTP. It
never issues or accepts the `__Host-` cookie, and it applies only when the
request really did arrive over loopback.

## What the proxy has to get right

| Requirement | Why |
|---|---|
| Terminate TLS and forward to the published web port | The stack speaks HTTP only |
| Serve **one** origin for both the app and `/v1/` | `__Host-` cookies are single-origin by definition; the bundled nginx already proxies `/v1/` and `/health` to the API |
| Set `X-Forwarded-Proto` and `X-Forwarded-For` | How the API learns the request was HTTPS |
| Have its address in `MYOWNNOTION_TRUSTED_PROXY_CIDRS` | Forwarded headers from untrusted sources are ignored, and rightly so — anyone can send them |
| Use a real hostname, not an IP | Passkeys need a registrable domain; `localhost` works, `127.0.0.1` does not |
| Preserve WebSocket upgrades on `/v1/` with a timeout of at least 60 seconds | Page synchronization uses a persistent same-origin channel with a 20-second heartbeat |

Set `MYOWNNOTION_PUBLIC_ORIGIN` to the public origin **exactly**, including the
port if it is not 443. A mismatch between it and what the browser sends
produces a refusal that looks like a bug and is the origin check working.

## Caddy

The shortest working configuration, and the one that handles certificates for
you:

```caddy
notes.example.com {
	reverse_proxy 127.0.0.1:5173
}
```

That is the whole file. Caddy sets `X-Forwarded-Proto` and `X-Forwarded-For`
itself and obtains a certificate on first request.

For a machine with no public DNS name, Caddy's internal CA works but the
certificate is not one your browser trusts by default:

```caddy
{
	local_certs
}

localhost {
	reverse_proxy 127.0.0.1:5173
}
```

Use `https://localhost`, not `https://127.0.0.1`. An IP address is not a secure
context for passkeys, and Caddy's internal certificate is issued for the name.

This repository also ships a **local-only** helper, `compose.dev.yaml`, that
runs that internal-CA Caddy in front of API and Vite processes that stay
running and reload themselves. It is not part of the official stack. Start
it detached with `bun run dev:stack` and open `https://localhost:8443`. See
`docs/development.md`.

## nginx

```nginx
server {
	listen 443 ssl;
	http2 on;
	server_name notes.example.com;

	ssl_certificate     /etc/letsencrypt/live/notes.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/notes.example.com/privkey.pem;

	# Large enough for the file uploads the API accepts. A proxy limit below
	# MYOWNNOTION_MAX_FILE_BYTES rejects uploads the application would have
	# taken, and the owner sees a proxy error page instead of an explanation.
	client_max_body_size 100m;

	# nginx does not forward WebSocket upgrade headers unless they are explicit.
	# Seventy-five seconds leaves room for the app's 20-second heartbeat and
	# 60-second liveness timeout without retaining dead connections forever.
	proxy_read_timeout 75s;
	proxy_send_timeout 75s;

	location / {
		proxy_pass http://127.0.0.1:5173;
		proxy_http_version 1.1;
		proxy_set_header Host              $host;
		proxy_set_header X-Real-IP         $remote_addr;
		proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header Upgrade           $http_upgrade;
		proxy_set_header Connection        "upgrade";
		proxy_buffering off;
	}
}

server {
	listen 80;
	server_name notes.example.com;
	return 301 https://$host$request_uri;
}
```

## Traefik

```yaml
# docker-compose.override.yaml
services:
  web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.myownnotion.rule=Host(`notes.example.com`)
      - traefik.http.routers.myownnotion.entrypoints=websecure
      - traefik.http.routers.myownnotion.tls.certresolver=letsencrypt
      - traefik.http.services.myownnotion.loadbalancer.server.port=8080
```

Traefik sets the forwarded headers by default. Its container address goes in
`MYOWNNOTION_TRUSTED_PROXY_CIDRS`.

## Diagnosing a realtime connection

Open the browser developer tools, select **Network**, then filter for
`/v1/page-sync/socket`. A healthy connection starts with **101 Switching
Protocols** and remains open while the workspace is visible.

- `403` means the browser origin does not exactly match
  `MYOWNNOTION_PUBLIC_ORIGIN`, or the proxy rewrote `Host`/scheme incorrectly.
- `401` means the secure session cookie did not reach the same origin.
- A connection that closes after roughly one minute usually means an upstream
  proxy has a timeout below 60 seconds or did not forward the heartbeat frames.
- A normal `200` response instead of `101 Switching Protocols` means the
  `Upgrade` and `Connection` headers were not preserved.

Do not add a Yjs, Hocuspocus, Draw.io, or other collaboration sidecar to repair
these symptoms. The API owns the durable page protocol; the proxy only carries
its WebSocket connection.

## Choosing an image, and going back

Images are selected by **exact tag or digest**, never `latest`:

```bash
MYOWNNOTION_API_IMAGE=ghcr.io/enzofrnt/myownnotion-api:v0.1.0
MYOWNNOTION_WEB_IMAGE=ghcr.io/enzofrnt/myownnotion-web:v0.1.0
```

A digest is stronger still, because a tag can be moved and a digest cannot:

```bash
MYOWNNOTION_API_IMAGE=ghcr.io/enzofrnt/myownnotion-api@sha256:…
```

**Rolling back is editing those two variables and running `docker compose up
-d`.** The data outlives the containers: `postgres-data` and `file-store` are
named volumes, and nothing in a rollback touches them.

Two cautions, both about the direction of travel:

- **Schema migrations run forward only.** The one-shot `migrate` job applies
  what the image ships. Rolling back to an image older than a migration that
  has already been applied is not supported, and the older API may not
  understand the schema it finds. Roll back to the version you came from, not
  to an arbitrary older one.
- **Keep the deployment key.** Rolling back the image does not roll back the
  key hierarchy. Every note is sealed under a key wrapped by whatever
  `MYOWNNOTION_DEPLOYMENT_KEY_FILE` points at, and the old image needs the same
  file.

## When something does not work

**"Client sent an HTTP request to an HTTPS server"** — you reached the proxy's
TLS port over HTTP. Use `https://`.

**`ERR_SSL_PROTOCOL_ERROR` on an IP address** — the certificate is issued for a
hostname. Use the name, not the address; passkeys need it anyway.

**Passkey registration never appears** — the browser does not consider the
origin secure. `https://` on a real hostname, or `http://localhost`. An IP
address will not do, whatever the scheme.

**Signed in, then immediately signed out** — `MYOWNNOTION_PUBLIC_ORIGIN` does
not match the origin the browser used, so the cookie was set for one origin and
sent from another. Compare the two exactly, port included.

**Uploads fail at a certain size** — the proxy's body limit is below
`MYOWNNOTION_MAX_FILE_BYTES`. Raise the proxy's.
