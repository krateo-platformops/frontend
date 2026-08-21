---
type: Architecture
title: frontend — SPA internals architecture
description: How the Krateo Composable Portal SPA is built — entry point, provider stack, the auto-discovered widget registry, the data-fetch layer, the Shell layout route and the routes-as-data model.
resource: ghcr.io/krateo-platformops/frontend
tags: [spa, react, widgets, internals]
timestamp: 2026-08-07T00:00:00Z
---

# frontend — architecture

How the Krateo Composable Portal SPA is built. Every claim is traced to the current tree
(paths relative to `ui/`) at `file:line`; if this page and the code disagree, the code wins.
This is the **internals** view; the deployment/chart/CRD wiring view is the root doc bundle
([../../docs/index.md](../../docs/index.md)).

## What it is

A **server-driven** React 19 + Vite SPA. It ships no hardcoded product pages: the
navigation, routes, and page content are all `Widget` custom resources fetched at runtime
from **snowplow** (which resolves the CRs into render-ready JSON). The SPA's job is to
fetch a widget, look up the React component for its `kind`, and render it. Adding UI is
adding CRs in the cluster, not editing the SPA.

Build/serve: `vite build` (`package.json` `scripts.build`) produces a static bundle; the
production image (`Dockerfile`) serves `/app` with the official nginx image, which
`try_files $uri /index.html` (`nginx.conf`) — the standard SPA fallback so client-side
routes resolve. nginx also reverse-proxies `/autopilot/` to the kagent A2A endpoint on the
same origin (`nginx.conf`, resolved at request time so the portal starts even when kagent
is absent). That proxy is bypassed entirely when the chart's `agentgateway.enabled` points
`AUTOPILOT_API_BASE_URL` at the agent gateway's own URL instead. Runtime config lives in a mounted `config/config.json` volume; the build stage
deletes the baked-in `dist/config` so production reads the mounted file, not the
build-time one.

## Entry point and provider stack

`src/index.tsx` optionally bootstraps browser-side OTel tracing **before** React mounts
(`src/index.tsx:7-12`, gated default-off on `config.api.OTEL_COLLECTOR_URL`), then mounts
`<App/>` inside `ThemeModeProvider` (light/dark). `src/App.tsx:57` establishes the provider
stack, from outer to inner:

```
QueryClientProvider (react-query)   App.tsx:59  — global client: retry:false, staleTime 30s (App.tsx:24-31)
  ConfigProvider (app)              App.tsx:60  — fetches /config/config.json (ConfigContext.tsx)
    RoutesProvider                  App.tsx:61  — holds RouteObject[] + menuRoutes (RoutesContext.tsx)
      AntdApp                       App.tsx:62  — antd message/notification context
        FiltersProvider             App.tsx:63  — cross-widget filter state
          AppInitializer            App.tsx:34  — builds the router, shows a Spin until config+routes load
```

`src/App.tsx:14` imports `./widgets/load` for its side effect — this populates the widget
registry **before first render** (see below). `AppInitializer` (`App.tsx:34`) also pipes
the SSE event firehose into the live-refresh registry once for the app's lifetime
(`App.tsx:39`, `hooks/useLiveRefresh.ts`), memoizes a `createBrowserRouter(routes)`
(`App.tsx:42-44`) and re-keys `<RouterProvider key={routerVersion}>` (`App.tsx:54`) so the
router is recreated whenever routes are registered at runtime.

## The widget registry (the core mechanism)

A widget `kind` (string) maps to a React component through a plain registry, split into
three modules to avoid an import cycle:

- `src/widgets/widget-module.ts:9` — the `WidgetModule` contract every widget's `index.ts`
  default-exports: `{ kind, component, paginated?, structural? }`. `defineWidget` (`:25`)
  is the identity helper enforcing the shape. There are **no kind aliases**: renames are a
  hard break, and existing cluster CRs migrate via
  [`cr-migration-map.json`](./cr-migration-map.json).
- `src/widgets/registry.ts:10` — a leaf `Map<string, WidgetModule>` plus `registerWidget`
  (`:12`) and `getWidgetModule` (`:17`). `getWidgetRegistry` (`:20`) exposes the
  antd-mapped set, excluding `structural` modules (`:24-27` — currently none: the old
  `Page`/`Route`/`RoutesLoader`/`NavMenu` structural kinds were removed; routing is data on
  the sidebar `Menu`). This module imports nothing heavy, so `WidgetRenderer` can depend on
  it without a cycle.
- `src/widgets/load.ts:17` — eagerly globs `./*/index.ts` (`import.meta.glob(..., {
  eager: true })`) and registers each module whose default export has a string `kind`. The
  glob MUST live here, not in `registry.ts`, because container widgets import
  `WidgetRenderer` → `registry.ts`; keeping the glob out of that leaf avoids a circular
  import (`load.ts:4-15` documents this). `Drawer`/`Modal` have an `index.ts` whose default
  export is the component (no `.kind`), so the guard at `load.ts:19-21` skips them.

There are 43 registry widget kinds under `src/widgets/` (one folder each; `Drawer` and
`Modal` are component-only, mounted by the Shell). Each folder is `src/widgets/<Kind>/`
with `<Kind>.schema.json` (CRD source of truth), `<Kind>.tsx` (the component), and
`index.ts`. Note the folder name and the `kind` can differ: `src/widgets/List/` registers
kind **`Listy`** (`List/index.ts:5-10` — Kubernetes reserves the `List` kind, so `kind:
List` CRs cannot be created). Authoring is documented in
[widget-authoring.md](./widget-authoring.md); the generated per-kind reference is
[widgets-api-reference.md](./widgets-api-reference.md).

## Rendering a widget — `WidgetRenderer`

`src/components/WidgetRenderer/WidgetRenderer.tsx:105` is the single render path. Given a
`widgetEndpoint` it:

1. resolves an optional **bounded server-side pagination** default by the endpoint's
   `resource` plural (`PAGINATED_RESOURCE_PAGE_SIZE`, `:35-37` — currently `tables: 50`,
   the guard against unbounded lists such as the compositions table) before the fetch
   (`:114-118`);
2. fetches the widget via `useWidgetQuery` (`:120`);
3. handles loading/error/empty states — it returns the loading skeleton on `isPending`
   (not `isLoading`) so retry-backoff gaps stay a skeleton, not the error cross
   (`:137-142`); a timeout-classified error gets a calm `WidgetTimeout` state with Retry
   (`:149-151`); other errors get `WidgetError` (`:157`);
4. handles a string `status` payload (an error/`Status` envelope from the backend): a
   `401` surfaces an authentication-error notification (`:172-181`), and a `500` +
   `credentials` message hard-redirects to `/login` (`:183-194`);
5. otherwise calls `parseWidget` (`:46`), which looks up the component with
   `getWidgetModule(kind)` (`:73`) — throwing `Unknown widget kind` when nothing is
   registered (`:76`) — filters `resourcesRefs.items` to `allowed` ones (`:66`, the RBAC
   gate), and renders `<Component …>` inside a `<Suspense>` boundary (`:83`) so
   code-split widgets (the chart widgets) show a fallback while their chunk loads;
6. wraps the element in `ScrollPagination` when `module.paginated` is true (`:88-99`), and
   overlays a `FreshnessBadge` whose "Live" state reflects an actually-open `/refreshes`
   subscription (`:123-129`, `hooks/refreshSse.ts`).

Container widgets render nested `WidgetRenderer`s for their child `resourcesRefs`, so a
single top-level fetch fans out into a tree of widget fetches.

## Data-fetch layer — `useWidgetQuery`

`src/hooks/useWidgetQuery.ts` is the canonical widget fetch. It builds the full URL as
`config.api.SNOWPLOW_API_BASE_URL + widgetEndpoint` (`:137`), attaches `Authorization:
Bearer <token>` from `getAccessToken()` (`:190`), and uses `useInfiniteQuery` (`:219`)
keyed on the widget URL (`:224`).

- **Retry policy**: the global client sets `retry:false` (`App.tsx:28`); this hook
  overrides it with `shouldRetryWidgetFetch` (`:52`, wired at `:231`) — retry transient
  failures (network errors with no status, 5xx, and 404 — treated as transient because
  snowplow can 404 while its informer cache is still cold, `:44-51`, `:54`) up to
  `MAX_WIDGET_FETCH_RETRIES=3` (`:35`); other 4xx (400/401/403) are never retried. This
  is what prevents the "red cross on first paint" while the backend is still warming up.
- **Pagination** is cumulative-slice: each page call returns the complete widget state for
  the slice so far; `getNextPageParam` (`:237`) stops when the server reports no
  continuation. Page advance is driven by `ScrollPagination`'s intersection observer for
  `paginated` widgets, plus the bounded server-side pager for the opt-in resource plurals
  (see above).
- **Live refresh**: when `WIDGET_LIVE_REFRESH_ENABLED` is on, each widget arms a
  per-widget `/refreshes` SSE subscription that refetches on push
  (`useWidgetLiveRefresh`, wired at `:327`).

A second fetch path exists for non-widget upstreams: `src/hooks/useApiFetch.ts`
(axios-based) and the events hooks (see [behavior.md](./behavior.md)).

## Routing — routes as data, one persistent Shell

Static routes are only `/login`, `/auth`, `/logout` (the recovery escape hatch — resolves
even when server-driven pages fail) and the authenticated **Shell layout route** with
`/profile` and a `*` catch-all to `WidgetPage` as children
(`src/context/RoutesContext.tsx:37-58`). Everything else is data:

- The Shell (`src/components/Shell/Shell.tsx`) is a pathless layout route rendering the
  server-driven **`Layout` widget** from `config.api.INIT` (`Shell.tsx:83`) — its Sider
  hosts the sidebar `Menu` widget, content routes render into its `<Outlet/>`. It guards
  auth client-side: no `localStorage['K_user']` → redirect to `/login`
  (`Shell.tsx:73-74`). It also mounts the imperative `Drawer`/`Modal` overlays, the
  notifications bell, command palette, theme + Autopilot toggles.
- The sidebar **`Menu`** widget's inline `widgetData.items` are the single route source
  (`src/widgets/Menu/Menu.tsx:22-40`): `buildNavModel`
  (`src/widgets/Menu/navModel.ts:89`) turns each item with a `path` into an `AppRoute`,
  resolving its content endpoint by precedence — explicit `resourceRefId` → the Menu's
  RBAC-resolved `resourcesRefs`, else the **convention page** `flexes/page-<slug>` in
  `config.params.FRONTEND_NAMESPACE` (`navModel.ts:42-53`, `Menu.tsx:24`). A label-less
  item registers a hidden route (detail/create pages); sidebar entries are RBAC-gated by
  ref survival (`navModel.ts:73-77`).
- `registerRoutes` (`RoutesContext.tsx:145`) inserts the routes as Shell children, de-dupes
  by path, and bumps `routerVersion` (`:165`) so `AppInitializer` rebuilds the router.
  `createRoute` (`RoutesContext.tsx:99`) maps a path template `/x/{namespace}/{name}` to a
  react-router path `/x/:namespace/:name` and renders a `WidgetPage` with the live params
  substituted into the endpoint.
- `WidgetPage` (`src/components/WidgetPage/WidgetPage.tsx:28`) resolves the active
  endpoint from `menuRoutes` by `location.pathname` (`:31,36`) and hands it to
  `WidgetRenderer`; while the Layout/Menu fetch is still in flight it shows loading, not
  404 (`:41-50`).

The old `NavMenu`/`NavMenuItem` discovery widgets and the `RoutesLoader`/`Route` invisible
route-registration widgets are **gone**, as is the `ROUTES_LOADER` config key — the INIT
`Layout` → sidebar `Menu` chain is the only bootstrap.

## Imperative overlays — Drawer / Modal

`Drawer` and `Modal` are mounted once in the Shell and opened imperatively via `window`
`CustomEvent`s, not props: `openDrawer()` / `closeDrawer()`
(`src/widgets/Drawer/Drawer.tsx:15-20`) dispatch events the mounted component listens for
(`:29-42`). Actions call these to pop a form/detail without a route change.

## Build/codegen scripts

`scripts/` (run via `tsx` from `ui/`, see `package.json` `scripts`) are dev/CI tooling,
not runtime: `gen-crds.ts` (widget `schema.json` → CRD via `krateoctl gen-widget`, output
to `scripts/krateoctl-output/`, gitignored), `generate-types.ts` (schema → `.type.d.ts`),
`scaffold-widget.ts`, `gen-antd-widgets.ts`, `validate-schemas.ts`,
`update-readme-widgets.ts` (regenerates
[widgets-api-reference.md](./widgets-api-reference.md)), and the example-portal runners
(`run-examples.ts`, `apply-*.ts`). CRD generation is wired into CI
(`.github/workflows/release-tag.yaml`, `crds` job) — see the root
[release runbook](../../docs/release.md) for where the generated CRDs land.
