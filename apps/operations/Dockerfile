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

COPY apps/operations apps/operations
COPY packages packages

RUN pnpm --filter @myownnotion/operations build

FROM ${NODE_IMAGE} AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/enzofrnt/MyOwnNotion" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="MyOwnNotion Operations"

RUN apk add --no-cache \
      postgresql18-client=18.4-r0 \
      rclone=1.72.1-r4 \
      bzip2 \
      ca-certificates \
 && update-ca-certificates \
 && RESTIC_VERSION=0.19.1 \
 && case "$(apk --print-arch)" in \
      x86_64) RESTIC_ARCH=amd64; RESTIC_SHA256=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c ;; \
      aarch64) RESTIC_ARCH=arm64; RESTIC_SHA256=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465 ;; \
      *) echo "unsupported architecture for restic" >&2; exit 1 ;; \
    esac \
 && wget -O /tmp/restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${RESTIC_ARCH}.bz2" \
 && echo "${RESTIC_SHA256}  /tmp/restic.bz2" | sha256sum -c - \
 && bunzip2 -c /tmp/restic.bz2 > /usr/local/bin/restic \
 && chmod 0755 /usr/local/bin/restic \
 && rm /tmp/restic.bz2 \
 && restic version | grep -F "${RESTIC_VERSION}"

ENV NODE_ENV=production \
    MYOWNNOTION_OPERATIONS_LOCK=/var/lib/myownnotion/operations/operations.lock \
    MYOWNNOTION_LEGACY_BLOB_ROOT=/var/lib/myownnotion/legacy-blobs \
    MYOWNNOTION_OPERATIONS_STAGING=/var/lib/myownnotion/staging \
    MYOWNNOTION_BACKUP_STATUS=/var/lib/myownnotion/operations/backup.json \
    MYOWNNOTION_BACKUP_SCHEDULE_STATE=/var/lib/myownnotion/operations/backup-schedule.json \
    MYOWNNOTION_RESTORE_STAGING=/var/lib/myownnotion/staging \
    MYOWNNOTION_RESTORE_GUARD=/var/lib/myownnotion/operations/.restore-in-progress \
    MYOWNNOTION_POSTGRES_MAJOR=18 \
    MYOWNNOTION_MIGRATIONS_ROOT=/app/migrations

WORKDIR /app
RUN mkdir -p \
      /var/lib/myownnotion/operations \
      /var/lib/myownnotion/legacy-blobs \
      /var/lib/myownnotion/staging \
    && chown -R node:node /var/lib/myownnotion /app

COPY --from=workspace --chown=node:node /workspace/apps/operations/dist ./dist
COPY --from=workspace --chown=node:node /workspace/packages/database/migrations ./migrations

USER node
ENTRYPOINT ["node", "dist/cli.mjs"]
