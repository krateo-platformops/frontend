#!/usr/bin/env bash
# Run the visual tests in the same Playwright container CI uses, so baselines are comparable.
#   visual/docker.sh                       check against the committed baselines
#   visual/docker.sh --update-snapshots    regenerate them
# node_modules is shadowed by an anonymous volume: the container installs Linux binaries without
# overwriting the host's.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('./package.json').devDependencies['@playwright/test']")-noble"
# Quote each argument so `-g "Button #1"` reaches Playwright as one pattern.
ARGS=$(printf '%q ' "$@")
docker run --rm --ipc=host -v "$PWD":/work -v /work/node_modules -w /work "$IMAGE" \
  bash -c "npm ci --no-audit --no-fund --loglevel=error && npm run visual:build -- --logLevel warn && npx playwright test -c visual/playwright.config.ts $ARGS"
