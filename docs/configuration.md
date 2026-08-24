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
| `agentgateway.enabled` | `false` | Send the Autopilot A2A calls to the agent gateway instead of kagent-ui (below). Injected by the installer from `features.agentGateway`. |
| `config.*` | see below | Rendered verbatim into the `config.json` the SPA boots from. |
| `previewSandbox.*` | `enabled: false` | The portal-builder live-preview sandbox (below). |

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
| `AUTOPILOT_API_BASE_URL` | `/autopilot` | Same-origin path served by the nginx `/autopilot/` proxy to the kagent A2A endpoint (no CORS). The Autopilot rail renders only when set; the upstream it dials is `autopilot.upstream`. |
| `AUTOPILOT_AVAILABLE` | `""` | Clickability (not visibility) of the Autopilot toggle: `"false"` (set by the installer when agents aren't deployed) grays it out; `""` defers to the runtime reachability probe, which also grays it out on a `401`/`403` (invalid session, or gateway RBAC denies this user the agent). |
| `OTEL_COLLECTOR_URL` | `""` | Browser OTel traces endpoint; empty = the browser SDK stays off. |
| `SNOWPLOW_IDENTITY_INJECTION` | `""` | String-typed rollout flag (installer plumbing emits strings only): `""` = legacy identity-extras behavior (safe hold-off); `"true"` = snowplow injects identity server-side. Never set `"false"` (JS truthiness trap — documented in `values.yaml`). |
| `PROVENANCE_ENABLED` | `""` | `"true"` emits one best-effort `AuditRecord` CR per gated portal write; needs the AuditRecord CRD. |
| `PREVIEW_SANDBOX_NAMESPACE` | `""` | The namespace draft widget CRs are applied into for live preview. **Do not set by hand when `previewSandbox.enabled`** — the chart then forces it to `previewSandbox.namespace` so config and provisioning cannot drift. |

The SPA additionally understands optional keys not in the chart defaults —
`WIDGET_LIVE_REFRESH_ENABLED` (default on), `RENDER_API_BASE_URL`,
`TERMINAL_SOCKET_URL`, and a `login` branding block — the full typed contract with
per-key semantics is `ui/src/context/ConfigContext.tsx` (see
[ui/docs/behavior.md](../ui/docs/behavior.md)). `params.FRONTEND_NAMESPACE` is rendered
from the release namespace, and is the namespace convention pages (`flexes/page-<slug>`)
resolve in.

## Container/nginx wiring

The image is the official nginx serving `/app`; at boot
`/docker-entrypoint.d/40-krateo-resolver.sh` (`ui/docker-entrypoint.sh`) substitutes:

1. the **listen port** from `FRONTEND_CONTAINER_PORT` (default `8080`) — which the
   Deployment sets to `service.port`, so Service, container, probes and nginx always
   agree;
2. the **cluster DNS resolver** into the `/autopilot/` proxy block, so `kagent-ui`
   resolves at *request* time — the portal starts (and `/autopilot/` degrades to 502)
   when autopilot is absent, instead of nginx crashlooping.

The `/autopilot/` location rewrites to the kagent A2A path
(`/api/a2a/krateo-system/autopilot/…`) and dials the kagent-ui Service on port 8080 with
SSE-friendly settings, passing the caller's `Authorization` header through untouched
(`ui/nginx.conf`). It is used only when `agentgateway.enabled` is off — with the gateway on,
the browser calls the gateway directly and nginx is not involved.

## `agentgateway.enabled` — and where the Autopilot JWT gets checked

The SPA sends the logged-in user's portal Bearer on **every** Autopilot A2A request. This
flag decides who validates it, by deciding what `AUTOPILOT_API_BASE_URL` ends up as:

| `agentgateway.enabled` | `AUTOPILOT_API_BASE_URL` | Path |
|---|---|---|
| `false` (default) | `/autopilot` — the same-origin nginx proxy | → kagent-ui → kagent controller. No gateway, so nothing validates the token. |
| `true` | the chart turns the gateway **origin** into `<origin>/api/a2a/<release-ns>/autopilot` | browser → the agent gateway → kagent controller, directly, like every other backend. The gateway validates the token against `authn`'s JWKS and applies per-user agent / tool / delegation RBAC. |

The origin comes from the installer, resolved by the same exposure model that produces
`SNOWPLOW_API_BASE_URL` and friends — so set `config.AUTOPILOT_API_BASE_URL` to the **origin
only** when overriding it by hand. A *relative* value is left untouched, so an origin that
has not resolved yet degrades to the kagent-ui proxy instead of rendering a broken URL.

The installer injects `true` from `features.agentGateway`, which also puts the kagent
controller in `trusted-proxy` mode. That mode is why the flag matters twice over: a request
with **no** `Authorization` header is rejected (`401` — the rail is simply dead), and a
request that does carry one is *trusted without verification*. Only the gateway verifies, so
leaving the rail on `/autopilot` with the gateway installed both works and is wrong — it
bypasses every RBAC layer and would accept a forged token.

> **This is a cross-origin call, so the gateway must answer CORS.** A browser precedes it
> with an unauthenticated `OPTIONS` preflight, which the gateway's authorization policy would
> `403`. `agentgateway-policies` has a `cors` block for exactly this, and the installer turns
> it on with the same `features.agentGateway` switch. Without it the rail cannot start.

## The preview sandbox (`previewSandbox.*`, default off)

When enabled, the chart provisions the quarantined namespace where the portal-builder
applies **draft** widget/RESTAction CRs so the deployed snowplow compiles them for the
in-drawer live preview: the namespace (default `krateo-preview`) with a TTL label, a
per-widget-plural object-count quota (`quota.perWidgetKind`, default 200;
`restactions`, default 50, over the plural list in `widgetPlurals` — mirrors the 43
CRDs; append new plurals here), author RBAC for the subjects in `authors` (default the
`admins` group; cohorts without a binding are fail-closed), and an hourly janitor
CronJob (`janitor.*`) deleting drafts older than `ttl` (default `24h`). The rendered
`config.json` then carries the sandbox namespace automatically. Templates:
`helm/frontend/templates/preview-sandbox/`.
