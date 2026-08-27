# syntax=docker/dockerfile:1.9
#
# Web image (feature 002, FR-032/FR-034).
#
# Same reproducibility rules as docker/api.Dockerfile: digest-pinned bases from
# docker/base-images.json, a frozen lockfile, non-secret build inputs only, and
# linux/amd64 + linux/arm64 from one definition. The build argument
# MYOWNNOTION_API_URL is a public origin, never a credential.

ARG BUN_BASE
ARG NGINX_BASE

FROM --platform=$BUILDPLATFORM ${BUN_BASE} AS builder
WORKDIR /app
ENV CI=1

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
COPY apps/web/ apps/web/

ARG MYOWNNOTION_API_URL=/
ENV MYOWNNOTION_API_URL=${MYOWNNOTION_API_URL}
RUN bun run --filter @myownnotion/web build


FROM ${NGINX_BASE} AS runtime
ENV TZ=UTC
# Apply the distribution's security updates. The web runtime is Alpine nginx
# serving static files: it has no Node.js and no package manager to strip.
USER root
RUN apk upgrade --no-cache
USER 101
COPY docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# nginxinc/nginx-unprivileged already runs as uid 101 and listens on 8080.
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=12 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
