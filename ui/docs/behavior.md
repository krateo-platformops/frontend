---
type: Architecture
title: frontend — runtime behavior & integration contracts
description: What the SPA does at runtime and its contracts with authn, snowplow and the events service — config.json, auth and token handling, bootstrap, pagination, actions, events and live refresh.
resource: ghcr.io/krateo-platformops/frontend
tags: [runtime, contracts, config, internals]
timestamp: 2026-08-07T00:00:00Z
---

# frontend — runtime behavior & integration contracts

What the SPA does at runtime and the contracts it has with the backends. Traced at
`file:line` (paths relative to `ui/`) against the current tree; code wins over prose.
Internals are in [architecture.md](./architecture.md); the deployment-side wiring (chart
values → `config.json`) is the root bundle's
[configuration doc](../../docs/configuration.md).

## Runtime configuration — `config.json`

The SPA has no compiled-in endpoints. At boot, `ConfigContext` fetches
`/config/config.json` with `cache:'no-store'` (`src/context/ConfigContext.tsx:112`); in
dev a `VITE_CONFIG_NAME=<name>` selects `/config/config.<name>.json` instead. The config
is a react-query query keyed on the config name (`:124-126`), and the app shows a global
spinner until it resolves (`App.tsx:46-52`).

The full typed shape — with the semantics of every key documented inline — is the `Config`
interface (`src/context/ConfigContext.tsx:4-96`). Required `api` keys:
`AUTHN_API_BASE_URL`, `SNOWPLOW_API_BASE_URL`, `EVENTS_API_BASE_URL`,
`EVENTS_PUSH_API_BASE_URL`, `INIT` (the bootstrap `/call` pointer to the app-shell
`Layout` CR), `TERMINAL_SOCKET_URL`. Optional keys gate whole subsystems (each default-off
or gracefully absent): `AUTOPILOT_API_BASE_URL` / `AUTOPILOT_AVAILABLE` (the Autopilot
rail + header toggle), `WIDGET_LIVE_REFRESH_ENABLED` (per-widget `/refreshes` SSE, on by
default), `SNOWPLOW_IDENTITY_INJECTION` (identity-extras rollout flag),
`PROVENANCE_ENABLED` (AuditRecord emission), `RENDER_API_BASE_URL` (helm-render dry-run
preview), `PREVIEW_SANDBOX_NAMESPACE` (portal-builder live preview), `OTEL_COLLECTOR_URL`
(browser tracing). `params` carries `FRONTEND_NAMESPACE` (the namespace convention pages
resolve in) and `DELAY_SAVE_NOTIFICATION`; an optional `login` block carries login-screen
branding.

The production image mounts this file as a volume; the build-time `dist/config` is deleted
(`Dockerfile`) so the running container reads the cluster-provided config, letting one
image serve any cluster. The chart renders it from `.Values.config`
(`helm/frontend/templates/configmap.yaml`).

> The in-repo dev sample `public/config/config.json` still carries the removed
> `ROUTES_LOADER` key and points `INIT` at the removed `navmenus` resource — the deployed
> contract is the chart's (`INIT` → `resource=layouts`, `name=app-shell`). Trust the
> `Config` type and the chart, not the dev sample.

## Upstream contracts

| Upstream | Base URL key | What the SPA calls | Code |
|----------|-------------|--------------------|------|
| **authn** | `AUTHN_API_BASE_URL` | `GET /strategies` (auth methods); the method's `path` for Basic/social login | `Login.tsx:59,83`, `Auth.tsx:27,52` |
| **snowplow** | `SNOWPLOW_API_BASE_URL` | `GET /call?resource=…&apiVersion=…&name=…&namespace=…` → a `Widget` JSON; SSE `/refreshes` when live refresh is on | `useWidgetQuery.ts:137`, `hooks/refreshSse.ts` |
| **events (list)** | `EVENTS_API_BASE_URL` | `GET /events` → seeded event list | `useGetEvents.ts:18` |
| **events (stream)** | `EVENTS_PUSH_API_BASE_URL` | SSE `GET /notifications` (bell + per-action event waits) | `useGetEvents.ts:21`, `useSseStream.ts`, `useHandleActions.ts:357` |
| **autopilot (optional)** | `AUTOPILOT_API_BASE_URL` | the kagent A2A endpoint, same-origin via the nginx `/autopilot/` proxy; every request carries the portal Bearer (agentgateway validates it, and the kagent controller reads the caller from it). The Evidence panel reads a delegation's stored activity from the sessions path derived off the same value | `components/Autopilot/transport.ts`, `components/Autopilot/evidence.ts`, `nginx.conf` |

All widget content flows through snowplow's **`/call`** endpoint; the SPA never talks to
the Kubernetes apiserver directly (portal writes also go through snowplow, against the
`resourcesRefs` verbs). The `Widget` shape it expects is `src/types/Widget.d.ts`
(`metadata`, `spec`, and a `status` that is either an object with
`widgetData`/`resourcesRefs`/`actions` or a string error envelope).

## Authentication & token handling

- **Login** (`src/pages/Login/Login.tsx`): fetches `GET /strategies` (`:59`), then on
  submit calls the chosen method's `path` with `Authorization: Basic base64(user:pass)`
  (`:83`). On success it stores the response in `localStorage['K_user']` (`:90`) and
  navigates in.
- **Social / OAuth callback** (`src/pages/Auth/Auth.tsx`): the provider redirects to
  `/auth?code=&state=&kind=`; the page matches `kind` against `/strategies`, validates
  `state` against `localStorage['KrateoSL']` when present (`:97`), exchanges the code via
  an `X-Auth-Code` header (`:52`), stores `K_user` (`:79`) and navigates home.
- **Token use** (`src/utils/getAccessToken.ts:5`): reads `accessToken` from `K_user`,
  caches it in a module variable, and throws if no user is stored (`:11-12`). Every
  `/call` carries it as `Authorization: Bearer <token>` (`useWidgetQuery.ts:190`). The
  cache is dropped via `invalidateAccessTokenCache` (`:28`) whenever the stored session
  changes without a full reload — the session-resume flow depends on this
  (`components/SessionResume`, `Auth.tsx:80`).
- **Logout & recovery** (`src/utils/logout.ts`): shared by the UserMenu action, the
  session-resume fallback, and the static `/logout` route — the escape hatch that resolves
  even when server-driven pages fail, force-clearing the session.
- **Auth guards**: the Shell redirects to `/login` when `K_user` is absent
  (`Shell.tsx:73-74`); server-side, a backend `500` + credentials `Status` envelope
  hard-redirects to `/login` (`WidgetRenderer.tsx:183-194`) and a `401` surfaces an
  auth-error notification (`:172-181`). The client guard is presence-only — real
  authorization is the backend's.

## The bootstrap sequence (cold load)

1. Fetch `config.json` (`ConfigContext`); optionally start browser OTel first
   (`index.tsx`).
2. The Shell layout route renders the **`Layout` widget** from `config.api.INIT`
   (`Shell.tsx:83`) — header chrome, Sider, content `<Outlet/>`.
3. The Layout's Sider resolves the sidebar **`Menu`** widget; its inline
   `widgetData.items` produce the sidebar entries **and** the app routes
   (`Menu.tsx:22-40`, `navModel.ts:89`) — content endpoints resolve via `resourceRefId`
   or the convention `flexes/page-<slug>` in `params.FRONTEND_NAMESPACE`.
4. `registerRoutes` inserts them as Shell children and re-keys the router
   (`RoutesContext.tsx:145,165`).
5. Navigating to a path resolves its endpoint (`WidgetPage.tsx:31-36`) and
   `WidgetRenderer` fetches + renders the page widget tree.

There is no routes-loader step: `ROUTES_LOADER` and the `RoutesLoader`/`Route`/`NavMenu`
widgets no longer exist.

## Pagination

List/grid widgets are `paginated` (`widget-module.ts:15`). When set, `WidgetRenderer`
wraps the widget in `ScrollPagination` (`WidgetRenderer.tsx:88-99`), an
intersection-observer that calls `fetchNextPage` when its sentinel enters the viewport.
`useWidgetQuery` uses cumulative-slice pagination (each page returns the full state so
far; `getNextPageParam` stops on no-continuation, `useWidgetQuery.ts:237`). Additionally,
resource plurals listed in `PAGINATED_RESOURCE_PAGE_SIZE` (`WidgetRenderer.tsx:35-37`)
get **bounded server-side pagination** with classic pager controls threaded to the widget
(`parseWidget` props `serverPagination`) — the guard for unbounded sets like the
compositions table.

## Actions

A widget's actions (declared in `widgetData.actions`, executed via
`src/hooks/useHandleActions.ts`) drive interactivity. Action `type`s:

- **`navigate`** — client-side navigation (`runNavigate`, `:238`), merging query params
  on same-path navigations (`:112-114`) and requiring a `path` (`:244`).
- **`openDrawer` / `openModal`** — pop the imperative overlay with the referenced
  resource's `widgetEndpoint` (`runOpenDrawer` `:268`, `runOpenModal` `:273`), via the
  `CustomEvent` mechanism (`Drawer.tsx:15`).
- **`rest`** — an HTTP call through snowplow against the action's `resourceRef` (`:279`);
  the verb comes from the resource ref (`GET/POST/PUT/PATCH/DELETE`, `:545-551`). The
  payload merges the action `payload` with the referenced resource payload and applies
  `payloadToOverride` (jq-interpolated) (`buildPayload`, `:157-172`; the legacy
  `payloadKey` nesting prop was removed). Optional `requireConfirmation` gates the call;
  `successMessage`/`errorMessage` surface notifications; `onSuccessNavigateTo` redirects
  on success (`:591`).
- **Event-driven completion** — a `rest` action with `onEventNavigateTo` opens an SSE
  `EventSource` on `EVENTS_PUSH_API_BASE_URL/notifications` and waits for the declared
  event `reason` before navigating, with a timeout (default 30s) and optional loading
  message (`:353-382`); `onSuccessNavigateTo` and `onEventNavigateTo` are mutually
  exclusive (`:308-311`).

Gated portal writes can additionally emit best-effort `AuditRecord` CRs when
`PROVENANCE_ENABLED` is on (`hooks/provenance.ts`) and fan out through the set fabric
(`hooks/runRestSet.ts`, `hooks/runRestFanOut.ts`).

The authoritative per-action property tables are generated from the schemas:
[widgets-api-reference.md](./widgets-api-reference.md).

## Events / notifications / live refresh

- `useGetEvents` (`src/hooks/useGetEvents.ts`) seeds the notifications list from
  `GET /events` (`:18`) and subscribes to the `/notifications` SSE stream (`:21`), capping
  the buffer at `MAX_EVENTS=200` (`:10`).
- `useSseStream` (`src/hooks/useSseStream.ts`) is the generic SSE hook: it subscribes to
  a topic on `EVENTS_PUSH_API_BASE_URL + endpoint` through the shared **ref-counted SSE
  client** (`src/hooks/sseClient.ts` — one `EventSource` per URL, shared by every
  subscriber), prepends parsed messages to a capped buffer, and flips `connecting` off
  after 10s without a message (`:30`).
- **Per-widget live refresh** (`hooks/refreshSse.ts`, `hooks/useLiveRefresh.ts`,
  `hooks/useWidgetLiveRefresh.ts`): when `WIDGET_LIVE_REFRESH_ENABLED` is not `false`,
  the app opens snowplow's `/refreshes` stream and arms per-widget subscriptions so a
  widget refetches when its backing cluster object changes; the `FreshnessBadge`'s "Live"
  dot reflects a genuinely-open subscription (`WidgetRenderer.tsx:123-129`).
