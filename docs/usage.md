---
type: Usage
title: frontend — usage
description: How to install and consume the portal — the Krateo installer path, direct helm install of both charts, the local render recipe for placeholder versions, and local development.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [install, helm, usage]
timestamp: 2026-08-07T00:00:00Z
---

# Usage

## Via the Krateo installer (the normal path)

frontend is a core portal component: the Krateo installer deploys it (and its CRDs
chart) at a pinned version and owns its wiring — the shared exposure port flows into
`service.port`, and the backend base URLs into the `config` block. On an installed
cluster you consume the portal by **applying Widget CRs**, not by touching this chart.

Equivalently, a `CompositionDefinition` can pin the chart directly (the in-repo
[`compositiondefinition.yaml`](../compositiondefinition.yaml) is such a sample —
substitute a published chart version):

```yaml
apiVersion: core.krateo.io/v1alpha1
kind: CompositionDefinition
metadata:
  name: krateo-frontend
  namespace: krateo-system
spec:
  chart:
    url: oci://ghcr.io/krateo-platformops/charts/frontend
    version: "1.4.3"
```

## Direct helm install (standalone)

CRDs first, then the app chart (both publish at the same version — see
[release](./release.md)):

```sh
helm install frontend-crds oci://ghcr.io/krateo-platformops/charts/frontend-crds \
  --version 1.4.3 --namespace krateo-system --create-namespace

helm install frontend oci://ghcr.io/krateo-platformops/charts/frontend \
  --version 1.4.3 --namespace krateo-system
```

A standalone portal is only useful next to its peers: authn, snowplow and the events
service must be reachable at the URLs you set in the `config` block
([configuration](./configuration.md)), and the `INIT` app-shell `Layout` CR (plus the
widgets it references) must exist in the cluster — a bare chart install renders a login
page and an empty shell until portal content CRs are applied.

## Rendering the charts locally (no cluster)

The in-repo `Chart.yaml`s carry `CHART_VERSION`/`APP_VERSION` placeholders (substituted
by the release workflow), so `helm template` needs a sed'd temp copy:

```sh
tmp=$(mktemp -d) && cp -R helm/frontend helm/frontend-crds "$tmp"/
sed -i 's/CHART_VERSION/0.0.0/g; s/APP_VERSION/0.0.0/g' "$tmp"/frontend/Chart.yaml "$tmp"/frontend-crds/Chart.yaml
helm template frontend "$tmp"/frontend
helm template frontend-crds "$tmp"/frontend-crds
```

## Local development (the `ui/` app)

All npm commands run from `ui/`.

1. **A cluster with Krateo installed** (e.g. Kind — see
   [docs.krateo.io](https://docs.krateo.io/)), or an existing remote cluster.
2. **Generate + apply the widget CRDs** (requires a **Go toolchain only** — the
   generator is this repo's own `crdgen/` module and `go build` replaces the install
   script this used to need; alternatively apply the committed
   `helm/frontend-crds/templates/`):

   ```sh
   npm run generate-crds   # → scripts/krateoctl-output/*.crd.yaml (gitignored)
   npm run apply-crds
   ```

3. **Point the dev config at your backends**: `public/config/config.json` (or a
   `config.<name>.json` selected via `VITE_CONFIG_NAME=<name>`). For an existing remote
   cluster, copy its deployed `config.json` to `public/config/config.remote.json` and
   run with `VITE_CONFIG_NAME=remote`. NB the committed dev sample lags the deployed
   contract (see [gotchas](../ui/docs/gotchas.md)) — prefer copying a real cluster's
   config.
4. **Run it**:

   ```sh
   npm install
   npm run dev            # → http://localhost:4000/login
   ```

   Log in with a user of that cluster (test installs: `admin` / the `admin-password`
   secret in `krateo-system`).

### The examples portal

To see every widget rendered with its example fixtures
(`ui/src/examples/widgets/*/*.example.yaml`), run the examples portal against a Krateo
cluster:

```sh
npm run examples        # applies CRDs + example CRs, then serves http://localhost:4000
```

It adds a sidebar item per widget kind, each page showing that widget's examples.

### Verifying changes

```sh
npm run generate-types && npx tsc --noEmit
npm run lint && npm run lint:css
npm test
npm run validate-schemas
```

Widget authoring (scaffolder, antd catalog, conventions):
[ui/docs/widget-authoring.md](../ui/docs/widget-authoring.md).
