# syntax=docker/dockerfile:1.9
#
# Local hot-reload image for `compose.dev.yaml`. Not a published runtime image.
# Dependencies install from bun.lock inside Linux so Darwin host `node_modules`
# never leak into the containers.

ARG BUN_BASE

FROM ${BUN_BASE}
WORKDIR /app
ENV CI=1 \
    TZ=UTC

COPY bun.lock bunfig.toml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/blob-store/package.json packages/blob-store/
COPY packages/client-core/package.json packages/client-core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/page-state/package.json packages/page-state/
COPY packages/test-utils/package.json packages/test-utils/
COPY scripts/ci/check-toolchain.ts scripts/ci/

RUN --mount=type=cache,id=bun-install,target=/root/.bun/install/cache \
    bun ci

COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/
COPY scripts/ scripts/

EXPOSE 3001 5173
