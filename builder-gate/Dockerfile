# The builder gate image. Built from the REPOSITORY ROOT (context "."), because the gate imports
# the portal's own lint and widget schemas from ui/src rather than copying them — so the image of a
# frontend tag carries exactly that tag's lint. Multi-arch in CI (component-image-build.yaml);
# never pushed from a workstation.
#
# Both build stages run on the BUILD platform and cross-compile, so the arm64 leg never runs npm or
# Go under emulation: the bundle is plain JavaScript and jqcheck is a static Go binary.

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS jqcheck
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY builder-gate/jqcheck/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/jqcheck .

FROM --platform=$BUILDPLATFORM node:22-alpine AS bundle
# The release tag (component-image-build passes VERSION to every module), stamped into the envelope.
ARG VERSION=dev
WORKDIR /repo/builder-gate
COPY builder-gate/package.json builder-gate/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/src /repo/ui/src
COPY builder-gate/ ./
RUN GATE_VERSION=$VERSION node build.mjs

FROM node:22-alpine
WORKDIR /app
COPY --from=bundle /repo/builder-gate/dist/server.cjs /repo/builder-gate/dist/cli.cjs ./
COPY --from=jqcheck /out/jqcheck /usr/local/bin/jqcheck
ENV NODE_ENV=production JQCHECK_BIN=/usr/local/bin/jqcheck PORT=8080
USER 10001
EXPOSE 8080
CMD ["node", "/app/server.cjs"]
