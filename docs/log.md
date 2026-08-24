---
type: Log
title: frontend — log
description: Curated chronological history — notable changes, decisions and incidents; release notes stay in GitHub Releases.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [history]
timestamp: 2026-08-21T00:00:00Z
---

# Log

Curated history, newest first. Durable decision records and dated notes live with the
code under [`ui/docs/`](../ui/docs/llms.txt) (e.g. the executed
[antd-migration-plan](../ui/docs/antd-migration-plan.md)).

## 2026-08-21 — forward the portal JWT to Autopilot, and call the gateway directly

The Autopilot rail POSTed its A2A turns with no `Authorization` header. That was fine while
kagent's A2A endpoint was open, and became a hard failure the moment `features.agentGateway`
put the kagent controller in `trusted-proxy` mode: it takes the caller from `jwt.sub` and
`401`s a tokenless request (verified in-cluster — tokenless is `401` through both `kagent-ui`
and the controller, `403` through the gateway).

- **The transport now carries the Bearer** (`a2aAuthHeader()`), re-read per attempt so a
  `tasks/resubscribe` after a long turn does not replay a stale token. `401`/`403` get their
  own messages instead of a bare status code.
- **The reachability probe carries it too**, and now treats `401`/`403` as unreachable — the
  toggle grays out for a user the gateway's RBAC denies, instead of being a dead click.
- **New `agentgateway.enabled`** (default `false`, injected by the installer from
  `features.agentGateway`, same shape as every agent chart's flag). It turns the gateway's
  origin — supplied by the installer's exposure model, like `SNOWPLOW_API_BASE_URL` — into
  `<origin>/api/a2a/<ns>/autopilot`. So the browser calls the gateway **directly**, exactly like
  it already calls authn, snowplow and sse-proxy; the `/autopilot/` nginx proxy (and kagent-ui
  with it) drops out of the path. That is the load-bearing half: `trusted-proxy` *trusts*
  whatever token it is handed, so only the gateway actually validates it and applies the
  agent/tool/delegation RBAC.

Being a cross-origin call, this needs the gateway to answer CORS: a browser sends an
unauthenticated `OPTIONS` preflight first, which the gateway's authorization policy `403`s.
`agentgateway-policies` gained a `cors` block for it, enabled by the same installer switch —
without it the rail cannot start. An intermediate design proxied `/agent-gateway/` through
nginx to keep the call same-origin; it was dropped once CORS on the gateway was confirmed to
short-circuit the preflight only (a real request with no/bad token is still `403`/`401`).

## 2026-08-07 — adopted the Krateo Documentation Standard

This bundle: root `docs/` + `examples/` + thin README; the pre-existing internals corpus
moved code-adjacent to `ui/docs/` and was re-derived file by file. The re-verification
caught real drift accumulated across the antd migration, the routes-as-data rework and
the monorepo fold, and rewrote it: docs still described the removed
`RoutesLoader`/`Route`/`Page`/`NavMenu`/`NavMenuItem` widgets and the `ROUTES_LOADER`
config key; kind rename-aliases that no longer exist; `DataGrid→List` where the
implemented kind is `Listy`; `Table.data`/`pageSize` instead of
`dataSource`/`pagination`; the removed Form `autocomplete`/`dependencies` feature and
`payloadKey` action prop; a release runbook that predated the monorepo (cross-repo PAT
instructions, wrong paths) and an `llms.txt` that pointed at this repo as "the chart
repo". The widgets API reference was regenerated from the current schemas (43 kinds).
The `crds` release job's `crds-subchart/` target is documented as a known seam in
[release.md](./release.md).

## 2026-08-04/05 — portal wiring hardening (1.4.x)

The nginx listen port became configurable (`FRONTEND_CONTAINER_PORT` ← chart
`service.port`, so the installer's shared exposure port reaches nginx itself); the
`/autopilot/` proxy repointed at kagent-ui :8080 with request-time DNS resolution (an
absent autopilot degrades to 502 instead of crashlooping the portal); the Autopilot
header toggle grays out (not hides) when the agent is unavailable
(`AUTOPILOT_AVAILABLE`).

## 2026-08-03 — the monorepo fold

The separate chart repo collapsed into `helm/` (`frontend` + `frontend-crds`, one
version line: image and both charts ship from one tag) and the app moved into `ui/`;
CI moved to the org's shared reusable workflows (multi-arch image build, canonical
`release-oci`). Known residue: the `crds` release job still targets the pre-fold
`crds-subchart/` path ([release.md](./release.md)).

## 2026-06 → 2026-07 — antd fidelity + routes-as-data + the copilot surface

The executed [antd-fidelity migration](../ui/docs/antd-migration-plan.md) (hard-break:
alias/legacy-prop purge, FlowChart on `@ant-design/graphs`, antd 6, dark mode) with the
`DataGrid→Listy` rename (Kubernetes reserves the `List` kind); the structural widgets
were removed in favor of routes-as-data on the sidebar `Menu` + the persistent Shell
layout route; the Autopilot rail, command palette, notifications rework, per-widget SSE
live refresh, provenance and the preview sandbox landed on this line.
