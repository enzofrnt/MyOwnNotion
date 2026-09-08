# syntax=docker/dockerfile:1.9

ARG BUN_BASE=oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
ARG PLAYWRIGHT_BASE=mcr.microsoft.com/playwright:v1.62.1-noble

FROM ${BUN_BASE} AS bun-runtime

FROM ${PLAYWRIGHT_BASE}
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

ENV CI=1 \
    PATH="/root/.bun/bin:/usr/local/bin:${PATH}"
WORKDIR /work

# Keep this layer dependent only on the locked dependency inputs. The live
# source is streamed into each disposable browser container afterwards.
COPY bun.lock bunfig.toml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/blob-store/package.json packages/blob-store/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/graph/package.json packages/graph/package.json
COPY packages/page-state/package.json packages/page-state/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json
COPY scripts/ci/check-toolchain.ts scripts/ci/check-toolchain.ts
COPY scripts/e2e/bootstrap-container.sh scripts/e2e/bootstrap-container.sh

RUN --mount=type=cache,id=bun-install,target=/root/.bun/install/cache \
    bash -lc 'source scripts/e2e/bootstrap-container.sh'
