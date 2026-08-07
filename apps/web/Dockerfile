# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.19.0-alpine3.23@sha256:244cc2b53f46f9e876304391d17682b0ddae9ac33491f4857e25e35a36ba7995
ARG NGINX_IMAGE=nginx:1.29.6-alpine3.23@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0

FROM ${NODE_IMAGE} AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/blob-store/package.json packages/blob-store/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json

RUN --mount=type=cache,id=myownnotion-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages

RUN pnpm --filter @myownnotion/web build

FROM ${NGINX_IMAGE} AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/enzofrnt/MyOwnNotion" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="MyOwnNotion Web"

COPY apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=workspace /workspace/apps/web/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
