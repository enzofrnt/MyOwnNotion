# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995

FROM ${NODE_IMAGE} AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/operations/package.json apps/operations/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/blob-store/package.json packages/blob-store/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json

RUN --mount=type=cache,id=myownnotion-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages
COPY scripts/db scripts/db

RUN pnpm --filter @myownnotion/api build

FROM ${NODE_IMAGE} AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/enzofrnt/MyOwnNotion" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="MyOwnNotion API"

ENV NODE_ENV=production \
    MYOWNNOTION_API_HOST=0.0.0.0 \
    MYOWNNOTION_API_PORT=3001 \
    MYOWNNOTION_BLOB_ROOT=/var/lib/myownnotion/blobs \
    MYOWNNOTION_MIGRATIONS_DIR=/app/migrations

WORKDIR /app
RUN mkdir -p /var/lib/myownnotion/blobs /app/migrations \
    && chown -R node:node /var/lib/myownnotion /app

COPY --from=workspace --chown=node:node /workspace/apps/api/dist ./dist
COPY --from=workspace --chown=node:node /workspace/packages/database/migrations ./migrations

USER node
EXPOSE 3001

CMD ["node", "dist/server.mjs"]
