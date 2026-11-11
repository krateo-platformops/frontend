---
type: Configuration
title: frontend — configuration
description: The whole config surface — chart values with defaults, the rendered config.json contract, the nginx/port wiring, the env ConfigMap and the preview sandbox.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [configuration, helm, config-json]
timestamp: 2026-08-07T00:00:00Z
---

# Configuration

Everything configurable, grounded in [`helm/frontend/values.yaml`](../helm/frontend/values.yaml)
+ [`values.schema.json`](../helm/frontend/values.schema.json) and the chart templates. The
`frontend-crds` chart has no values of its own (it only ships the CRDs).

> **Installer note:** when the Krateo installer deploys this chart, the
> `values.schema.json` **defaults** are applied — the schema, not `values.yaml`, is the
> effective source of truth for the rendered ConfigMap. The
> `values-schema-drift` CI job guards the two from drifting.

## Chart values

| Value | Default | Effect |
|---|---|---|
| `replicaCount` | `1` | Pod replicas (ignored when `autoscaling.enabled`). |
| `image.registry` / `image.repository` | `ghcr.io` / `krateo-platformops/frontend` | The SPA image. `global.imageRegistry` (default `""`) overrides the registry host on every image for mirror/air-gapped installs. |
| `image.tag` | `""` | Empty → the chart `appVersion` (the tag the release built). Pin here to override. |
| `image.pullPolicy` | `IfNotPresent` | |
| `service.type` / `service.port` | `ClusterIP` / `8080` | One value drives everything port-shaped: Service port, `containerPort`, probes **and** nginx's actual listen port (below). The installer's per-component `exposePort` lands here. |
| `ingress.*` | `enabled: false` | Standard optional ingress. |
| `resources` | `{}` | No defaults — set consciously. |
| `livenessProbe` / `readinessProbe` | HTTP `/` on `http` | Probe the SPA index. |
| `autoscaling.*` | `enabled: false` (1–100 pods, 80% CPU) | Standard HPA. |
| `serviceAccount.*` | `create: true`, `automount: true` | The portal needs no cluster permissions of its own (all data access goes through snowplow as the end user). |
| `podAnnotations` / `podLabels` / `nodeSelector` / `tolerations` / `affinity` / `podSecurityContext` / `securityContext` | `{}` | Standard pass-throughs. |
| `env` | *(unset)* | Free-form extra env vars, rendered into the `<fullname>` ConfigMap consumed via `envFrom`. |
| `agentgateway.enabled` | `false` | Send the Agentiko A2A calls to the agent gateway instead of kagent-ui (below). Injected by the installer from `features.agentGateway`. |
| `agentName` | `agentiko` | The orchestrator Agent the portal talks to, in both modes: with the gateway on, the last segment of `<origin>/api/a2a/<release-ns>/<agentName>`; otherwise the derived same-origin base `/<agentName>`, used when `config` sets neither `AGENTIKO_API_BASE_URL` nor `AUTOPILOT_API_BASE_URL`. An explicit base URL wins. Typed in the schema, defaulted only in `values.yaml`. |
| `config.*` | see below | Rendered verbatim into the `config.json` the SPA boots from. |
| `previewSandbox.*` | `enabled: false` | The portal-builder live-preview sandbox (below). |
| `login.*` | *(unset)* | Login-screen branding, rendered as the `login` object of `config.json` (below). |

The pod template carries a `checksum/configmap` annotation, so config changes roll the
Deployment.

## The `config.json` contract (`.Values.config`)

The chart renders `.Values.config` into the `<fullname>-config-vars` ConfigMap as
`config.json` (`templates/configmap.yaml`) and mounts it at `/app/config` — the SPA has
**no compiled-in endpoints** and stalls on a spinner without this file. Keys and chart
defaults:

| Key | Default | Effect |
|---|---|---|
| `SNOWPLOW_API_BASE_URL` | `http://localhost:8081` | The content API (`GET /call`) — every widget fetch. |
| `AUTHN_API_BASE_URL` | `http://localhost:8082` | Login strategies + token exchange. |
| `EVENTS_API_BASE_URL` / `EVENTS_PUSH_API_BASE_URL` | `http://localhost:8083` | Events list (`/events`) / SSE stream (`/notifications`). |
| `INIT` | `/call?resource=layouts&…&name=app-shell&namespace=krateo-system` | The bootstrap pointer to the app-shell `Layout` CR. There is no `ROUTES_LOADER` anymore — routing is data on the sidebar `Menu`. |
| `AUTOPILOT_API_BASE_URL` | *(unset → `/<agentName>`)* | Unset under both names, the chart derives `/<agentName>` (`/agentiko` by default): the same-origin path served by the nginx location for that Agent, proxied to its kagent A2A endpoint (no CORS). Set it explicitly to override; `""` hides the rail. It is deliberately absent from `values.yaml` and has no schema default, since either would count as set. The Agentiko rail renders only when the value is non-empty; the upstream it dials is `autopilot.upstream`. The Evidence panel's session-trace URL is derived from this value, not configured separately (see below). |
| `AUTOPILOT_AVAILABLE` | `""` | Clickability (not visibility) of the Agentiko toggle: `"false"` (set by the installer when agents aren't deployed) grays it out; `""` defers to the runtime reachability probe, which also grays it out on a `401`/`403` (invalid session, or gateway RBAC denies this user the agent). |
| `OTEL_COLLECTOR_URL` | `""` | Browser OTel traces endpoint; empty = the browser SDK stays off. |
| `SNOWPLOW_IDENTITY_INJECTION` | `""` | String-typed rollout flag (installer plumbing emits strings only): `""` = legacy identity-extras behavior (safe hold-off); `"true"` = snowplow injects identity server-side. Never set `"false"` (JS truthiness trap — documented in `values.yaml`). |
| `PROVENANCE_ENABLED` | `""` | Provenance for gated portal writes (on unless `"false"`). Where snowplow's `/capabilities` lists `call.provenance`, each write carries an `X-Krateo-Provenance` header and snowplow records it; otherwise one best-effort `AuditRecord` CR is POSTed per write, which needs the AuditRecord CRD. `"false"` turns both off. |
| `PREVIEW_SANDBOX_NAMESPACE` | `""` | The namespace draft widget CRs are applied into for live preview. **Do not set by hand when `previewSandbox.enabled`** — the chart then forces it to `previewSandbox.namespace` so config and provisioning cannot drift. |
| `BUILDERS_NAMESPACE` | `krateo-system` | The namespace the Builder CRs (Portal, Blueprint, Controller Builders) live in. The frontend lists them as the signed-in user (snowplow `/list?category=builders`), so that user needs `get`/`list` on `builders.builders.templates.krateo.io` there. Empty, or a failed read, means no builder opens and the builder routes say why; there is no bundled fallback. No schema default (see `NO_DEFAULT`). |

### `AGENTIKO_*` and `AUTOPILOT_*`: one key, two names

Every `AUTOPILOT_<KEY>` (the two above, the builder, git and voice keys in `values.yaml`, and
`AUTOPILOT_VOICE_TTS_MODEL` / `AUTOPILOT_VOICE_STYLE_PROMPT`) is also accepted as
`AGENTIKO_<KEY>`, the name after the product's rename. Values may set either name:

- **Precedence:** `AGENTIKO_<KEY>` wins whenever it is set, an empty string included. Unset, the
  `AUTOPILOT_<KEY>` value is used.
- **The chart** emits both names into `config.json` with that one value, and appends the
  gateway A2A path to both when `agentgateway.enabled`. `values.yaml` and the schema default only
  the `AUTOPILOT_` names; the `AGENTIKO_` names are typed in `values.schema.json` and never
  defaulted, because a default would always be present and beat an installer override still
  written under the old name.
- **The SPA** reads each key through one resolver, `agentikoConfig()` in
  `ui/src/context/agentikoConfig.ts`, with the same precedence.

The rollout order: this frontend first, then the installer switches its values to the
`AGENTIKO_` names, and once every cluster runs that installer the `AUTOPILOT_` fallback is removed
from the resolver, the chart template and `scripts/gen-config-schema.py`.

The SPA additionally understands optional keys not in the chart defaults —
`WIDGET_LIVE_REFRESH_ENABLED` (default on), `RENDER_API_BASE_URL`,
`TERMINAL_SOCKET_URL` — the full typed contract with per-key semantics is
`ui/src/context/ConfigContext.tsx` (see [ui/docs/behavior.md](../ui/docs/behavior.md)).
`params.FRONTEND_NAMESPACE` is rendered from the release namespace, and is the namespace
convention pages (`flexes/page-<slug>`) resolve in.

### The login screen (`.Values.login`)

The top-level `login` value is rendered as the `login` object of `config.json`, beside `api` and
`params`, and the SPA reads it as `config.login`. Every key is optional and off when unset: the
block is absent from `values.yaml` and has no schema default, so an install that sets nothing gets
no `login` object, byte for byte the `config.json` of a chart without this value. Set, `config.json`
carries exactly the keys that are set.

| Key | Effect when set | Schema |
|---|---|---|
| `installationName` | The heading's second line reads "to Krateo PlatformOps · `<name>`". | string, non-empty |
| `requestAccountUrl` | Shows "Request an account", linked here. | an absolute `https://` URL, or a same-origin path starting with `/` (not `//` or `/\`) |
| `logoUrl` / `logoAlt` | The login-panel logo and its alt text, in place of the bundled Krateo logo. | string, non-empty |
| `headline` / `subtitle` | Marketing copy. | string, non-empty |
| `highlights` | Short lines of copy. | up to 5 strings, each 1–120 characters |

The block is typed by `scripts/gen-config-schema.py` (`LOGIN`), so the `values-schema-drift` job
also catches a default added by hand; `scripts/test_chart_login.py` (the `chart-render` job) renders
the chart and checks the result. **The installer's `componentValues` schemas are closed**: an install
can set `login` only once the installer declares it under `componentValues['frontend']`.

## Container/nginx wiring

The image is the official nginx serving `/app`; at boot
`/docker-entrypoint.d/40-krateo-resolver.sh` (`ui/docker-entrypoint.sh`) substitutes:

1. the **listen port** from `FRONTEND_CONTAINER_PORT` (default `8080`) — which the
   Deployment sets to `service.port`, so Service, container, probes and nginx always
   agree;
2. the **cluster DNS resolver** into every proxy block, so `kagent-ui`
   resolves at *request* time — the portal starts (and the proxy degrades to 502)
   when kagent is absent, instead of nginx crashlooping.

There is one proxy location per Agent, named after it, plus its sessions sibling for the
Evidence panel:

| Location | Rewrites to |
|---|---|
| `/agentiko/` | `/api/a2a/krateo-system/agentiko/…` |
| `/agentiko/sessions/` | `/api/sessions/…` (`GET` only) |
| `/autopilot/` | `/api/a2a/krateo-system/autopilot/…` |
| `/autopilot/sessions/` | `/api/sessions/…` (`GET` only) |

The portal reads the agent a thread belongs to from the location's name, so a location must
rewrite to the Agent it is named after (`ui/src/components/Agentiko/a2aEndpoint.test.ts`
checks `nginx.conf` and the vite dev proxy). `/autopilot/` is removed once Agent `autopilot`
is retired. Each A2A location dials the kagent-ui Service on port 8080 with
SSE-friendly settings, passing the caller's `Authorization` header through untouched
(`ui/nginx.conf`). It is used only when `agentgateway.enabled` is off — with the gateway on,
the browser calls the gateway directly and nginx is not involved.

## `agentgateway.enabled` — and where the Agentiko JWT gets checked

The SPA sends the logged-in user's portal Bearer on **every** Agentiko A2A request. This
flag decides who validates it, by deciding what `AUTOPILOT_API_BASE_URL` ends up as:

| `agentgateway.enabled` | `AUTOPILOT_API_BASE_URL` | Path |
|---|---|---|
| `false` (default) | `/<agentName>` (default `/agentiko`) — the same-origin nginx proxy | → kagent-ui → kagent controller. No gateway, so nothing validates the token. |
| `true` | the chart turns the gateway **origin** into `<origin>/api/a2a/<release-ns>/<agentName>` (default `agentiko`) | browser → the agent gateway → kagent controller, directly, like every other backend. The gateway validates the token against `authn`'s JWKS and applies per-user agent / tool / delegation RBAC. |

The origin comes from the installer, resolved by the same exposure model that produces
`SNOWPLOW_API_BASE_URL` and friends — so set `config.AUTOPILOT_API_BASE_URL` to the **origin
only** when overriding it by hand. A *relative* value is left untouched, so an origin that
has not resolved yet degrades to the kagent-ui proxy instead of rendering a broken URL.

The **Evidence** panel's session read follows the same split, derived from the same value:
`<origin>/api/sessions/<id>/tasks` through the gateway (allowed by `sessionTrace` on
`agentgateway-policies`, `GET` only), or `/agentiko/sessions/<id>/tasks` through the nginx
proxy. Nothing configures it separately, and a denied or unreachable read only costs the panel
its delegated rows.

The installer injects `true` from `features.agentGateway`, which also puts the kagent
controller in `trusted-proxy` mode. That mode is why the flag matters twice over: a request
with **no** `Authorization` header is rejected (`401` — the rail is simply dead), and a
request that does carry one is *trusted without verification*. Only the gateway verifies, so
leaving the rail on a relative path with the gateway installed both works and is wrong — it
bypasses every RBAC layer and would accept a forged token.

> **This is a cross-origin call, so the gateway must answer CORS.** A browser precedes it
> with an unauthenticated `OPTIONS` preflight, which the gateway's authorization policy would
> `403`. `agentgateway-policies` has a `cors` block for exactly this, and the installer turns
> it on with the same `features.agentGateway` switch. Without it the rail cannot start.

## The preview sandbox (`previewSandbox.*`, default off)

When enabled, the chart provisions the quarantined namespace (default `krateo-preview`)
where previews write their drafts, and the author RBAC for the subjects in `authors`
(default the `admins` group; cohorts without a binding are fail-closed). Two previews use it:

- the **page builder** applies draft widget and RESTAction CRs there, so the deployed
  snowplow compiles them for the in-drawer live preview;
- the **Blueprint Composer** writes each draft chart there as one ConfigMap and renders it
  by name (portal `blueprint-render-draft`), because a chart sent in a GET's `?extras`
  passes the gateway's 16 KB HTTP/2 header limit. The ConfigMap is deleted as soon as the
  render answers.

There is no quota and no janitor: each preview removes what it wrote. The rendered
`config.json` carries the sandbox namespace automatically. Templates:
`helm/frontend/templates/preview-sandbox/`.
