---
type: Architecture
title: frontend — overview
description: What the Krateo Composable Portal does and how it works — the server-driven widget model, the nginx runtime, the two charts, and how it composes with authn, snowplow, eventrouter and autopilot.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [portal, architecture, widgets]
timestamp: 2026-08-07T00:00:00Z
---

# Overview

## What it does

frontend serves the **Krateo Composable Portal** — the web UI of Krateo PlatformOps. It
is deliberately thin: a static React SPA behind nginx that holds **no product state and
no product pages**. Everything a user sees — the app shell, the sidebar, every route and
every page — is described by **`Widget` custom resources** in the cluster
(`widgets.templates.krateo.io/v1beta1`, 43 kinds — buttons, tables, forms, charts,
layout containers…). snowplow resolves those CRs into render-ready JSON under the
caller's own RBAC; the SPA fetches a widget, looks up the React component for its
`kind`, and renders it. Building portal UI therefore means **applying CRs, not shipping
frontend code**.

## How it works (runtime)

```
browser ──/config/config.json──▶ nginx (this container) ── static SPA bundle
   │                                   └── /autopilot/* ──▶ kagent A2A (same-origin proxy)
   ├──/strategies, login ────────────▶ authn
   ├──GET /call?resource=…&name=… ───▶ snowplow  ──▶ Widget CRs + RESTActions (user's RBAC)
   ├──GET /events, SSE /notifications▶ eventrouter/sse
   └──SSE /refreshes ────────────────▶ snowplow (per-widget live refresh)
```

- **One image, any cluster**: the SPA compiles in no endpoints. The chart renders a
  `config.json` ConfigMap (base URLs, the `INIT` bootstrap pointer, feature flags) and
  mounts it into the container; the build-time config is deleted from the image.
- **Bootstrap**: `config.api.INIT` points at the app-shell `Layout` CR
  (`resource=layouts`, `name=app-shell` by default). The Layout's sidebar `Menu` widget
  carries the navigation **and** the routes as inline data — each menu item's `path`
  registers a route whose content resolves to a referenced widget or, by convention, to
  a `Flex` named `page-<slug>` in the frontend namespace.
- **RBAC-shaped UI**: snowplow resolves every referenced widget as the requesting user
  and marks refs `allowed`; the renderer drops what the user may not access, so two
  users see two different portals from the same CRs.
- **Writes go through snowplow too**: widget `rest` actions POST/PUT/PATCH/DELETE
  against the referenced resources under the user's identity; nothing talks to the
  Kubernetes apiserver directly from the browser.
- **nginx runtime**: the official nginx image serves the bundle with the SPA
  `try_files` fallback and reverse-proxies `/autopilot/` to the kagent A2A endpoint on
  the same origin (resolved at request time, so the portal runs fine when autopilot is
  absent — the header toggle then grays out). The listen port is substituted at boot
  from `FRONTEND_CONTAINER_PORT`, which the chart wires to `service.port`.

The full code-traced internals (registry, renderer, data-fetch, routing, auth, events)
are the code-adjacent corpus: [ui/docs/architecture.md](../ui/docs/architecture.md) and
[ui/docs/behavior.md](../ui/docs/behavior.md).

## The artifacts (one repo, one version line)

| Artifact | What | Where |
|---|---|---|
| image | the SPA + nginx | `ghcr.io/krateo-platformops/frontend:X.Y.Z` (built from `ui/`) |
| `frontend` chart | Deployment + Service + the `config.json`/env ConfigMaps (+ optional ingress, HPA, preview sandbox) | `oci://ghcr.io/krateo-platformops/charts/frontend:X.Y.Z` (`helm/frontend/`) |
| `frontend-crds` chart | the 43 widget CRDs | `oci://ghcr.io/krateo-platformops/charts/frontend-crds:X.Y.Z` (`helm/frontend-crds/`) |

Widget CRDs are **generated** from each widget's `schema.json` (via krateoctl), so a
widget's cluster schema and its renderer come from the same source tree — see
[release](./release.md) for how the copies stay in sync.

## Platform peers

- **authn** — login strategies + token issuance; the SPA stores the session in
  `localStorage` and sends `Authorization: Bearer` on every content call.
- **snowplow** — the content API (`GET /call`); resolves Widgets + RESTActions.
- **eventrouter / sse** — the notifications bell list + SSE streams, also used by
  event-driven action completion.
- **autopilot (kagent)** — optional copilot rail, reached through the same-origin
  `/autopilot/` proxy; gated by `AUTOPILOT_API_BASE_URL` / `AUTOPILOT_AVAILABLE`. Every
  A2A request carries the user's portal Bearer, and `agentgateway.enabled` points those
  calls at the agent gateway (a direct cross-origin call, like every other backend) so it
  validates the token and enforces per-user RBAC.
- **the Krateo installer** — deploys frontend + frontend-crds as pinned charts and owns
  the day-2 values (ports, base URLs) — see [usage](./usage.md).
