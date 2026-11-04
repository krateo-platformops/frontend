---
type: Architecture
title: frontend — gotchas
description: Real runtime pitfalls grounded in the current code and config — mounted config, server-driven blank portals, unknown kinds, retry/pagination semantics, token caching, SSE limits, CRD drift.
resource: ghcr.io/krateo-platformops/frontend
tags: [gotchas, runtime, internals]
timestamp: 2026-08-07T00:00:00Z
---

# frontend — gotchas

Runtime pitfalls, each grounded in the code/config (paths relative to `ui/`). Traced at
`file:line`; verify against the tree at the deployed tag before relying on any of these.

## Config is mounted, not baked — a missing/empty volume breaks everything

The production image deletes `dist/config` at build (`Dockerfile`) and reads
`/config/config.json` from a mounted volume at runtime (`ConfigContext.tsx:112`). If the
volume is missing or the file is malformed, `fetchConfig` throws and the app stalls on the
global spinner (`App.tsx:46-52`) — there is no fallback config. The base URLs and the
`INIT` bootstrap pointer all come from this file, so the chart-side wiring
(`helm/frontend/templates/configmap.yaml`) is what makes the SPA functional. The dev
sample `public/config/config.json` is **stale** (it still names `ROUTES_LOADER` and a
`navmenus` INIT) — the chart's `config` block is the deployed truth.

## The whole UI is server-driven — a blank portal is usually a backend/CR problem

Only `/login`, `/auth`, `/logout`, `/profile` and the `*` catch-all exist statically
(`RoutesContext.tsx:37-58`). The shell, sidebar, routes and content are `Widget` CRs
fetched from snowplow. An empty sidebar or 404-everywhere portal typically means the INIT
`Layout` CR (`resource=layouts`, `name=app-shell` in the chart default) or the sidebar
`Menu` CR it references is missing/unresolvable, or snowplow returned an error envelope —
not a frontend bug. Check the `/call` responses first.

## Unknown widget `kind` throws, not degrades — and there are no aliases

`parseWidget` throws `Unknown widget kind: <kind>` when no module is registered
(`WidgetRenderer.tsx:76`). Kind rename-aliases were removed (hard-break policy): a legacy
kind (`Panel`, `DataGrid`, `NavMenu`, `Page`, …) does not resolve at all. Existing cluster
CRs migrate via [`cr-migration-map.json`](./cr-migration-map.json). Also remember the one
irregular name: the list widget's kind is **`Listy`**, not `List` (Kubernetes reserves
`List`; `src/widgets/List/index.ts:5-10`).

## `isPending` vs `isLoading` — and the retry override

`WidgetRenderer` shows the skeleton on `isPending`, NOT `isLoading`
(`WidgetRenderer.tsx:137-142`), and `useWidgetQuery` overrides the global `retry:false`
(`App.tsx:28`) with `shouldRetryWidgetFetch` (`useWidgetQuery.ts:52,231`). Together these
keep a warming-up backend showing a skeleton instead of the error "red cross" on first
paint; a timeout-classified failure gets the calm `WidgetTimeout` state
(`WidgetRenderer.tsx:149-151`). 4xx is deliberately NOT retried — EXCEPT 404, which is
treated as transient (cold snowplow informer cache on first paint,
`useWidgetQuery.ts:44-54`); 5xx/network/404 retry up to 3 times (`:35`). If you change
the retry config or swap `isPending` for `isLoading`, the cold-start UX regresses to an
immediate error flash.

## Pagination: intersection observer for slices, an explicit map for bounded pagers

Cumulative-slice page advance comes solely from `ScrollPagination`'s intersection
observer, and only for widgets whose module sets `paginated`
(`WidgetRenderer.tsx:88-99`) — a widget that should paginate but isn't marked `paginated`
only ever shows page 1. Separately, **bounded server-side pagination** is opt-in by
resource plural via `PAGINATED_RESOURCE_PAGE_SIZE` (`WidgetRenderer.tsx:35-37`; currently
`tables: 50`) — resources not in that map fetch with snowplow's full-set sentinel, which
is exactly the 60K-row wedge the map exists to prevent. Don't "merge" slice pages: each
page is the complete state so far.

## The access token is cached — every `K_user` write must invalidate it

`getAccessToken` caches the token in a module variable (`getAccessToken.ts:3-8`) and
throws when `K_user` is absent (`:11-12`). Any code path that writes a fresh `K_user`
**without a full page reload** must call `invalidateAccessTokenCache` (`:28`) — the
session-resume modal and the OAuth callback do (`Auth.tsx:80`); a new path that forgets
will replay the stale Bearer token until something hard-reloads. The backend
credentials-error path forces `window.location.replace('/login')`
(`WidgetRenderer.tsx:183-194`), which resets the cache by reloading.

## Auth is two cooperating guards, both required

Client-side, the Shell redirects to `/login` when `K_user` is missing
(`Shell.tsx:73-74`); server-side, snowplow's error envelopes are handled in
`WidgetRenderer` (`:172-194`). The client guard is presence-only — an expired/invalid
token passes it and is caught only by the backend. Don't treat the client redirect as
authorization. `/logout` is a static route on purpose: it must resolve even when every
server-driven page fails (`RoutesContext.tsx:40-44`, `utils/logout.ts`).

## SSE has no auth header, is shared per URL, and errors tear the connection down

SSE goes through the shared ref-counted client (`src/hooks/sseClient.ts`): every
subscriber to the same URL shares ONE `EventSource`, opened `withCredentials:false` and
with no `Authorization` header (`sseClient.ts:49`) — the browser `EventSource` API can't
set custom headers, so the events stream must be reachable without a bearer token. On
`onerror` the **shared** connection is torn down for every subscriber (`sseClient.ts:51-54`);
a later subscribe reopens it, but existing subscribers stay disconnected — a transient
blip can leave a stream dead until something re-subscribes. `useSseStream` additionally
flips `connecting` off after 10s without a message (`useSseStream.ts:30`). The events
*list* (`useGetEvents`, `/events`) is the durable source; SSE prepends live deltas. The
per-widget live-refresh stream (`hooks/refreshSse.ts`) is a separate, managed channel with
its own arm/refetch bookkeeping.

## `routerVersion` re-key recreates the whole router

Registering runtime routes bumps `routerVersion` (`RoutesContext.tsx:165`) and
`<RouterProvider key={routerVersion}>` is re-keyed (`App.tsx:54`), tearing down and
rebuilding the router. `registerRoutes` de-dupes by path and returns unchanged state when
there is nothing new (`RoutesContext.tsx:145-165`), and `updateMenuRoutes` returns the
previous array reference on content-equal input (`:126-133`) — that reference equality is
what prevents an infinite render loop, because the Menu re-derives its routes on every
render. Preserve those short-circuits when touching this code.

## Convention pages resolve in FRONTEND_NAMESPACE only

A sidebar `Menu` item without a `resourceRefId` resolves its content to
`flexes/page-<slug>` **in `config.params.FRONTEND_NAMESPACE`** (`navModel.ts:42-53`,
`Menu.tsx:24`) — a convention `Flex` page created in any other namespace will 404. Also:
RBAC-driven nav gating requires the item to carry a `resourceRefId` (ref-survival gate,
`navModel.ts:73-77`); convention/route-only items fail open and stay visible.

## CRDs are generated here; two copies exist in this monorepo

The source of truth for a widget's cluster schema is
`src/widgets/<Kind>/<Kind>.schema.json`; `npm run generate-crds` (this repo's `crdgen/`) produces the
CRDs as gitignored build artifacts. The **shipped** CRDs are the committed copy in
[`helm/frontend-crds/templates/`](../../helm/frontend-crds/templates/) (43 CRDs,
published as the `frontend-crds` chart), while the release workflow's `crds` job still
syncs its output to a `crds-subchart/` path via an auto-PR — see the
[release runbook](../../docs/release.md) for the current state of that seam. Schema (image
tag) and deployed CRD (chart version) can drift when a sync PR isn't merged for a tag; a
newer widget CR applied against an older frontend image throws `Unknown widget kind`.

## Autopilot dictation sends microphone audio to Google Vertex AI

Enabling dictation means setting `config.AUTOPILOT_VOICE_TRANSCRIBE_URL` to a
`/chat/completions` endpoint on the agent gateway. **Its presence is the on/off switch**;
empty (the default) and no microphone control renders at all, so the composer is unchanged.

Four things an operator must know before setting it:

- **The audio goes to Vertex.** The gateway's `/llm/v1` backend is an
  `AgentgatewayBackend` with `spec.ai.provider.vertexai` (`region: global` — no region
  guarantee), and that is true **even on installs that have moved the agent fleet to a
  local model**, because the route, not the `ModelConfig`, decides. The audio is used only
  to produce text in the composer; nothing reaches an agent until the user presses Send.
- **HTTPS is required everywhere, not just on the portal.** Capture needs
  `window.isSecureContext`, so a plain-HTTP portal renders no control whatever this key
  says (one `console.info` on first rail open names the reason and the origin). And the
  moment the portal is `https://`, every backend URL in `config.json` must be too, or the
  browser blocks them as mixed content.
- **A dedicated `/stt/v1` route is recommended over `/llm/v1`.** The `/llm/v1` route
  carries the response guardrails policy, which **masks** e-mail addresses, phone numbers
  and `*.local` hostnames inside a transcript (the user sees words they did not say, with
  no signal) and **rejects** credential-shaped prose with a 502. A route on the same
  backend without that policy is safe by construction here: the model has no tools and no
  cluster data on this call, so the only content it can return is what the user said.
- **`AUTOPILOT_VOICE_MODEL` must accept inline audio.** It has to be a model the gateway
  routes to a backend that takes a `file` part with a `data:audio/…;base64,…` URL; a
  `gemini-*` model on the Vertex backend does. An `input_audio` part is silently discarded
  by the gateway's Gemini translation, which is why the client never sends one — and why
  it verifies from `usage.prompt_tokens` that audio was actually billed before letting any
  text reach the composer. With no audio the model does not error: it returns a fluent,
  confident, invented sentence.
