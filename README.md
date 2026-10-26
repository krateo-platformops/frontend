# frontend

The Krateo Composable Portal: a server-driven React SPA that renders `Widget` custom
resources — resolved to JSON by snowplow — so portal UI is built by applying CRs, not by
shipping frontend code.

## What is this

The web UI of Krateo PlatformOps, deliberately thin: a static SPA behind nginx with no
product state and no hardcoded pages. The app shell, sidebar, routes and content are all
widget CRs (`widgets.templates.krateo.io`, 45 kinds), RBAC-shaped per user by snowplow.
One monorepo, one version line: the app (`ui/`) and its Helm charts (`helm/frontend/`,
`helm/frontend-crds/`) ship together from a single tag.
Full picture: [docs/index.md](docs/index.md).

## Install

Normally installed by the **Krateo installer**, which pins the chart. Standalone:

```sh
helm install frontend-crds oci://ghcr.io/krateo-platformops/charts/frontend-crds \
  --version 1.4.3 --namespace krateo-system --create-namespace
helm install frontend oci://ghcr.io/krateo-platformops/charts/frontend \
  --version 1.4.3 --namespace krateo-system
```

Details, backend wiring and the local dev/examples-portal workflow:
[docs/usage.md](docs/usage.md).

## Configure

See [docs/configuration.md](docs/configuration.md). Most used:

| Setting | Default | Effect |
|---|---|---|
| `config.SNOWPLOW_API_BASE_URL` (+ `AUTHN_…`, `EVENTS_…`) | `http://localhost:808x` | The backend base URLs rendered into the mounted `config.json` — the SPA has no compiled-in endpoints. |
| `config.INIT` | `/call?resource=layouts&…&name=app-shell&…` | The bootstrap pointer to the app-shell `Layout` CR; the sidebar `Menu` it references carries the routes as data. |
| `service.port` | `8080` | One value drives Service, containerPort, probes **and** nginx's listen port (`FRONTEND_CONTAINER_PORT`). |

## Examples

- [examples/hello-page](examples/hello-page) — a convention `Flex` page
  (`page-hello`) with a Paragraph + Button; routes-as-data in one apply.
- [examples/namespaces-table](examples/namespaces-table) — a `Table` fed by a
  `RESTAction` over the Kubernetes API, rows built by a `widgetDataTemplate` jq.

## Docs

- [docs/index.md](docs/index.md) — the map (bundle + the code-adjacent deep corpus)
- [docs/overview.md](docs/overview.md) — what it does and how it works
- [docs/usage.md](docs/usage.md) — how to install / consume it
- [docs/configuration.md](docs/configuration.md) — the whole config surface
- [docs/api.md](docs/api.md) — the 43 widget CRDs + the widget spec model
- [docs/examples.md](docs/examples.md) — examples index
- [docs/release.md](docs/release.md) — how a release ships
- [docs/log.md](docs/log.md) — curated history

Internals (code-traced): [ui/docs/architecture.md](ui/docs/architecture.md) and the
corpus indexed by [ui/docs/llms.txt](ui/docs/llms.txt); widget authoring:
[ui/docs/widget-authoring.md](ui/docs/widget-authoring.md).

## Develop & release

`cd ui && npm install && npm run dev` (against a Krateo cluster — see
[docs/usage.md](docs/usage.md)); verify with `npx tsc --noEmit && npm run lint && npm
test && npm run validate-schemas`. Tag `X.Y.Z` (no `v`) ships image + both charts —
release runbook: [docs/release.md](docs/release.md).
