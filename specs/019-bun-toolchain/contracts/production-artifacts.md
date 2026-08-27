# Contract: Bun production artifacts

## API build

`bun run --filter @myownnotion/api build` MUST use `Bun.build()` with a Bun
target and produce:

~~~text
apps/api/dist/
├── server.js
├── server.js.map
├── migrate.js
├── migrate.js.map
├── assets/
│   └── *loro*.wasm
└── admin/
    ├── admin-cli.js
    └── admin-cli.js.map
~~~

Required behavior:

- every entry loads with Bun 1.4.0;
- Loro resolves through its bundler export, emits a relocation-safe Wasm asset
  and never retains a build-host `node_modules` path;
- `server.js` starts Fastify, serves `/health`, upgrades the page-sync
  WebSocket, logs safely and terminates on `SIGINT`/`SIGTERM`;
- `ws` resolves to Bun's built-in compatibility module, never an npm fallback;
- the page-sync upgrade rejects an invalid Origin or missing cookie before
  opening, authenticates the durable session immediately after opening, and
  buffers no more than eight frames or 2 MiB before that authentication;
- buffered frames preserve order and reach the page-sync protocol only after a
  valid owner session; overflow and invalid sessions close with the existing
  safe WebSocket codes;
- `migrate.js` keeps the backup/key/version guards and applies the same SQL;
- `admin-cli.js` keeps command names, JSON shapes and exit codes, and its build
  smoke proves that the outer dispatcher executes exactly once without also
  starting the imported security command implementation;
- `/app/migrations` remains available in the API image;
- no output requires Node.js or a host build path.

## Web build

`bun run --filter @myownnotion/web build` MUST use `Bun.build()` and produce at
least:

~~~text
apps/web/dist/
├── index.html
├── service-worker.js
├── service-worker.js.map
└── assets/
    ├── *.js
    ├── *.css
    ├── search.worker-*.js
    ├── *loro*.wasm
    └── *.webmanifest
~~~

Required behavior:

- every URL emitted in `index.html` exists and is rooted under `/`;
- the main client references the emitted search-worker URL, never the source
  `.ts` path;
- the worker answers `{ type: "clear" }` with a cold, empty index;
- Tailwind, component styles and BlockNote styles are present;
- Loro Wasm loads from the emitted URL;
- the public API URL is injected only from `MYOWNNOTION_API_URL` and contains no
  secret;
- the service worker is registered only by the production build;
- Workbox precaches functional HTML/JS/CSS/manifest/worker/Wasm assets and no
  API route or response;
- after one successful online load, the shell and search worker work after the
  browser is put offline.

## Container images

### API

- Builder and runtime use the pinned Bun 1.4.0 Debian manifest.
- Runtime user is `bun`, not root.
- `bun --version` returns exactly `1.4.0`.
- no standalone Node.js runtime is present; the official image's optional
  `node` compatibility alias MUST resolve to the Bun binary itself.
- Command is `bun dist/server.js`; migration is `bun dist/migrate.js`.
- Healthcheck is implemented with Bun.
- Only bundles, SQL migrations and required runtime directories are copied.

### Web

- Builder uses the same pinned Bun manifest.
- Runtime remains pinned nginx-unprivileged and user 101.
- The served tree is exactly `apps/web/dist`.
- Existing security headers, SPA fallback and WebSocket proxy behavior remain.

### Both

- `linux/amd64` and `linux/arm64` MUST build from one Dockerfile each.
- Bases MUST be manifest-list digest pinned.
- No secret or owner data may appear in layers or build arguments.
- Commit and release publication labels/digests remain tied to the validated
  SHA.

## Data compatibility

No application schema or protocol version may change because of this build.
An installation initialized before feature 019 MUST start with the new images,
pass integrity checks, read its pages/files and restore reference backups
without content conversion.

## Acceptance probes

1. Build API and Web twice from the frozen dependency graph.
2. Validate the artifact inventory and every reference.
3. Serve the Web build, activate the service worker, go offline and reload.
4. Execute the search worker while offline.
5. Build and smoke the API image natively, checking runtime identity and
   absence of Node.
6. Build both images for both supported architectures.
7. Start official Compose, migrate an empty database and run representative
   HTTP, WebSocket, backup/restore and browser journeys.
8. Verify native `ws` resolution plus exact pre-authentication frame/count
   boundaries, eager hello replay, invalid session and revocation behavior.
