# syntax=docker/dockerfile:1.9
#
# API image (feature 002, FR-032/FR-034).
#
# Reproducibility rules:
#   - the base image is pinned by manifest-list digest through NODE_BASE, whose
#     value comes from docker/base-images.json; `pnpm images:build` refuses to
#     build with an unpinned base;
#   - dependencies install from the committed pnpm-lock.yaml with
#     --frozen-lockfile; no network resolution may change the tree;
#   - build inputs are non-secret only. No secret value, key file, or `.env` is
#     copied into any layer. The deployment wrapping key is mounted at runtime.
#   - builds for linux/amd64 and linux/arm64 from the same definition.

ARG NODE_BASE
ARG APPLICATION_VERSION=0.1.0

FROM --platform=$BUILDPLATFORM ${NODE_BASE} AS builder
WORKDIR /app
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

# Manifests and lockfile first so dependency layers cache independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/blob-store/package.json packages/blob-store/
COPY packages/client-core/package.json packages/client-core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/page-state/package.json packages/page-state/
COPY packages/test-utils/package.json packages/test-utils/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts=false

COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm --filter @myownnotion/api... run build

# Production dependency tree only, still from the frozen lockfile.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @myownnotion/api --prod deploy --legacy /deploy


FROM ${NODE_BASE} AS runtime
ARG APPLICATION_VERSION=0.1.0
WORKDIR /app
ENV NODE_ENV=production \
    TZ=UTC \
    MYOWNNOTION_APPLICATION_VERSION=${APPLICATION_VERSION} \
    MYOWNNOTION_API_HOST=0.0.0.0 \
    MYOWNNOTION_API_PORT=3001

# Attack-surface reduction, measured against the container scan:
#   - apply the distribution's security point releases, which is where the
#     fixable OS findings actually get fixed;
#   - delete npm, npx, and corepack. The runtime executes `node dist/server.mjs`
#     and never installs anything, yet npm's own bundled dependency tree
#     (glob, minimatch, picomatch, brace-expansion, tar, sigstore) accounts for
#     most of the fixable JavaScript findings in the image.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && rm -rf /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Durable blob volume and mounted-secret directory are provided by Compose.
RUN mkdir -p /var/lib/myownnotion/blobs /var/lib/myownnotion/backups \
 && chown -R node:node /var/lib/myownnotion

# `dist/` holds both entrypoints: `server.mjs` and the `migrate.mjs` the
# Compose `migrate` job runs. The reviewed SQL sits at /app/migrations, which
# is where dist/migrate.mjs resolves it from.
COPY --from=builder --chown=node:node /deploy/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
COPY --from=builder --chown=node:node /app/packages/database/migrations ./migrations

USER node
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MYOWNNOTION_API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
