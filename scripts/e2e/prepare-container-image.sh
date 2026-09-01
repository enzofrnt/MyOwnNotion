#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

playwright_base="${MYOWNNOTION_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.62.1-noble}"
bun_base="$(bun -e 'const value = await Bun.file("docker/base-images.json").json(); console.log(value.bases.bun.ref + "@" + value.bases.bun.digest);')"
image_key="$({
    shasum -a 256 \
        bun.lock \
        bunfig.toml \
        package.json \
        apps/api/package.json \
        apps/web/package.json \
        packages/*/package.json \
        docker/e2e-browser.Dockerfile \
        scripts/ci/check-toolchain.ts \
        scripts/e2e/bootstrap-container.sh
    printf '%s\n' "${playwright_base}" "${bun_base}"
} | shasum -a 256 | awk '{print substr($1, 1, 16)}')"
prepared_image="myownnotion-e2e-playwright:${image_key}"

docker build \
    --file docker/e2e-browser.Dockerfile \
    --build-arg "BUN_BASE=${bun_base}" \
    --build-arg "PLAYWRIGHT_BASE=${playwright_base}" \
    --tag "${prepared_image}" \
    .

printf 'MYOWNNOTION_PREPARED_PLAYWRIGHT_IMAGE=%s\n' "${prepared_image}"
