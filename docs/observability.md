---
type: Configuration
title: frontend — browser telemetry span contract
description: The five OpenTelemetry span names the UI SLO is computed from, their boundaries, how they reach snowplow, and why renaming one or moving a boundary is a breaking change.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [observability, opentelemetry, slo, tracing]
timestamp: 2026-10-31T00:00:00Z
---

# Browser telemetry: the span contract

The portal emits OpenTelemetry spans from the browser so the platform's UI SLO
(`docs/SLO.md` in observability: interaction p95 ≤ 2s) can be measured rather than asserted.

**The five span names and their boundaries below are a CONTRACT.** The SLI query and the SLO
dashboard key on them literally. Renaming a span, or moving where one starts or ends, is a
**breaking change** for the consumer even though nothing in this repo fails to compile — a
boundary change silently alters what the p95 claims. Change either only in agreement with
whoever owns the SLI.

## Off unless configured

No provider starts and no `traceparent` is injected unless `OTEL_TRACES_ENDPOINT` (or the older
`OTEL_COLLECTOR_URL`) is set in the runtime config. `ui/src/index.tsx` does not even `import()`
the tracing module without it, so the default path is byte-identical to having no telemetry.

## Where traces go

To **snowplow**, not to a browser-reachable collector:

```
POST  <SNOWPLOW_API_BASE_URL>/telemetry/v1/traces      OTLP/HTTP JSON
      e.g. https://portal.krateo.dev/content/telemetry/v1/traces
```

Authenticated with the **session's own bearer** — the same token the SPA sends to `/call`, so no
credential reaches a separate telemetry host. snowplow validates size and rate, allowlists the
five names and a fixed attribute set, and forwards to the in-cluster collector. It answers `401`
without the token, `413` over the size cap and `429` over the per-user rate limit.

## The five spans

| name | in the interaction SLO | starts | ends |
|---|---|---|---|
| `krateo.composition.open` | yes | navigation intent into a composition | every initial widget resolved and rendered |
| `krateo.form.submit` | yes | after validation passes, and after confirm if one interposes | the outcome is rendered (toast, or the error shown) |
| `krateo.page.publish` | yes | the publish's write confirmed (the blast-radius dialog's Confirm — not the Publish press) | the provider's answer is rendered (the change-request link, or the refusal) |
| `krateo.page.load` | **no** | document load | — |
| `krateo.widget.fetch` | no (a child) | one portal → snowplow request | its response |

### The rule the boundaries come from

**A span measures what the user waits for: from committed intent to visible outcome.** Time the
user spends thinking or confirming is not ours.

Three consequences that are easy to get wrong, each of which would have *flattered* the p95:

- **A validation failure produces NO span.** The user never waited on us, and counting a cheap
  client-side rejection as a fast interaction would improve the percentile by doing less.
- **`page.publish` starts at the last confirm, not at the Publish press.** Between the two sit two
  human gates — the destination form ("Where should this page be committed?") and the blast-radius
  confirm, which can stay open for five minutes. Both are a person's dwell, not platform latency.
  A publish cancelled at either gate, or refused before the confirm (lint, preview gate, claim
  name), produces NO span, for the validation-failure reason above.
- **`composition.open` ends when every initial widget has resolved, not at first paint.** An empty
  shell is not "open". First paint is the number that would have looked best.
- **Abandonment is marked, not dropped.** Navigating away before the end ends the span with
  `krateo.interaction.abandoned=true`, excluded from latency but still counted — a silently missing
  span hides the abandonment rate.

### Where each span is produced

| name | produced by |
|---|---|
| `krateo.composition.open` | `otel/useCompositionOpenSpan.ts`, from `components/WidgetPage` |
| `krateo.form.submit` | `hooks/useHandleActions.ts` (`runRest`, past the HITL gate); the Form only tags the dispatch |
| `krateo.page.publish` | `builders/host/BuilderHost.tsx` (the write confirmed → the provider's answer rendered); the provider announces the confirm on the publish-confirmed bus (`hooks/runRestSet.ts` `onConfirmed`, `components/Agentiko/AgentikoProvider.tsx`) |
| `krateo.page.load` | `otel/useDocumentLoadSpan.ts`, from `components/Shell` |
| `krateo.widget.fetch` | auto-instrumentation, renamed by `ContractSpanProcessor` |

The emitters are `otel/interactions.ts`. One other place in the SPA creates a span — see
[The counted span](#the-counted-span-krateoagentikoclaimunbacked) below — and one more
auto-instrumented request is exported outside the SLI: see
[The A2A span](#the-a2a-span-krateoagentikoa2a).

**Not instrumented, deliberately** — each would be measured wrongly rather than not at all:

- A **set / fan-out** form submit (`action.ops`, `action.fanOutPath`): one span would have to cover
  N gated writes with a confirm between them, and confirm time is excluded by the rule above.
- A document loaded at **`/login`**: the exporter authenticates with the session's bearer, so a
  span emitted before sign-in cannot be delivered at all.
- An interaction on a page whose **templated route cannot be resolved** (the route table has not
  arrived, or the address matches only the `*` catch-all).

**Which spans can report abandonment.** `composition.open` (the page unmounted before its reads
settled) and `page.publish` (the builder was left, or Publish pressed again, after the write was
confirmed and before the provider answered). `form.submit` cannot: its outcome toast is raised
app-wide whether or not the submitting widget is still mounted, so what ends that span is always
the write — never the user leaving.

### Attributes

Route templates only, and the same keys on every span of a name. Imported from
`@opentelemetry/semantic-conventions`, never written as literals (#589).

| name | `http.route` | `http.request.method` | `http.response.status_code` |
|---|---|---|---|
| `krateo.composition.open` | yes | — | — |
| `krateo.form.submit` | yes | yes | — |
| `krateo.page.publish` | yes | — | — |
| `krateo.page.load` | yes | — | — |

Two rules from the consumer's aggregation (observability#90, the `span_metrics` connector) decide
that table, and both are easy to break by being helpful:

- **`http.route` must be the TEMPLATED route** — `/compositions/:namespace/:name`, never
  `/compositions/krateo-system/foo-123`. Every distinct value is its own metric series and the cap
  is 1,000 combinations per service per agent, so concrete paths exhaust it and the metric stops
  meaning anything. Nothing fails while that happens. The route therefore comes from the router's
  own match (`otel/route.ts`), and where none resolves **no span is emitted**.
- **Per span name, a key is ALWAYS present or ALWAYS absent.** `http.response.status_code` is a
  dimension with no default: carrying it sometimes splits one series into two. So no span carries
  it — not even `krateo.form.submit`, where the status IS known whenever the server answered,
  because a network failure or an event timeout has no status to carry.

### Errors

Recorded, never dropped: span status `ERROR`, and **no** status-code attribute. `krateo.sli.error`
is derived as "5xx, or `ERROR` with no status code", so the span status alone is what makes a
failure count. Latency is computed over OK spans and the error rate separately, so a fast failure
cannot improve the p95.

The mirror of that rule is the dangerous one: an `ERROR` status on a span that SUCCEEDED counts
every success as a failure. Each producer therefore has a must-not-fire test asserting that a
successful operation leaves the status unset (`otel/interactions.instrumentation.test.ts`).

### Linking

The `krateo.widget.fetch` spans an interaction causes are its **children**, in the same trace, and
carry W3C `traceparent` to snowplow — which emits its own Server span. So one trace shows
interaction → fetch → server, and an interaction that took 2.4s can be attributed rather than
merely observed.

## The counted span: `krateo.agentiko.claim.unbacked`

Outside the SLI. One span per reply in which Agentiko claims an action its turn did not back,
produced by `components/Agentiko/claimTelemetry.ts` under the tracer `krateo-agentiko`. It is
counted, not timed: its duration means nothing. Agreed with snowplow:

| attribute | values |
|---|---|
| `krateo.agentiko.claim.family` | `preview`, `publish`, `apply`, `controller`, `compose`, `chart` |
| `krateo.agentiko.claim.outcome` | `missing`, `refused`, `failed`, `declined`, `dropped` |

Those two and nothing else. Not the claimed phrase (model output about the person's resources),
and **no session or conversation id**: no identity on spans, plain or hashed (snowplow#848), and a
conversation id leads to a person through the conversation store. snowplow forwards a value only
if it matches `^[a-z][a-z0-9_]{0,31}$`; `claimTelemetry.test.ts` checks every family and outcome
`claimCheck.ts` defines against it.

`ContractSpanProcessor` exports it (`COUNTED_SPAN_NAMES` in `otel/spanContract.ts`, kept apart
from the five `SPAN_NAMES`). snowplow forwards it only once its own allowlist names it; until then
the ingest drops it per span, counted as `dropped_name`, and the rest of the batch is forwarded.

```
SpanName = 'krateo.agentiko.claim.unbacked'
GROUP BY SpanAttributes['krateo.agentiko.claim.family'], SpanAttributes['krateo.agentiko.claim.outcome']
```

## The A2A span: `krateo.agentiko.a2a`

Outside the SLI. One span per JSON-RPC call the portal makes to Agentiko's A2A endpoint
(`AGENTIKO_API_BASE_URL`, e.g. `https://portal.krateo.dev/api/a2a/krateo-system/agentiko`): a
`POST` under that base. The rail's availability probe — a `GET` of the same base on every page
load and window focus — is not an agent call, and stays dropped exactly as before. It is
**the fetch instrumentation's own span**, renamed by `ContractSpanProcessor` — not a second span.
So its context is the `traceparent` the request carried, and the gateway's `POST /api/a2a/*` span,
whose parent it already was, now has that parent stored: one trace shows the portal's request →
gateway → agent. Agreed with snowplow (snowplow#1398), whose ingest allowlists the same name.

| starts | ends |
|---|---|
| `fetch` is called | the response **body** has been read to its end |

**For `message/stream` that is the whole streamed turn, not the time to stream start.**
instrumentation-fetch 0.223 clones the response and drains the clone before it ends the span, so
an SSE reply keeps the span open until its last byte. Two consequences:

- A body that errors mid-way — the rail aborting the turn, a dropped connection — ends the span
  at that moment, through the library's error path, with `http.response.status_code` **0** even
  though a 200 had arrived. A `0` therefore means "the body did not complete", not "no answer".
- A tab closed mid-stream never ends the span, so nothing is exported for that request.

Both are pinned against the installed library in `ui/src/otel/spanContract.a2a.test.ts`: a bump
that moves where the span ends fails there, because a moved boundary silently changes what the
duration claims.

| attribute | value |
|---|---|
| `http.request.method` | `POST` — the only method that becomes this span |
| `http.response.status_code` | as recorded; `0` when the request or its body failed (above) |
| `http.route` | always the literal template `/api/a2a/{namespace}/{agent}` — never the concrete path, which snowplow refuses |
| `krateo.a2a.method` | the JSON-RPC method, only when it is `message/stream`, `message/send`, `tasks/get` or `tasks/resubscribe`; **absent** otherwise |

Those four and nothing else — an allowlist (`a2aAttributesOf`), so an attribute a future
instrumentation adds is not exported by default. `url.full` goes (it names the namespace and the
agent), as do `server.address`, `server.port`, `error.type` and `http.request.method_original`.
Headers and the body never become attributes.

`krateo.a2a.method` is a **closed enum** on snowplow's side, which drops and counts any other
value, so the browser omits it rather than sending one: a call whose method is outside the four
is still exported, without it. `tasks/resubscribe` is in the enum because the transport really
sends it, to resume a dropped stream. Today every call the transport makes carries one of the
four, but the key is optional by contract, so do not make it a `span_metrics` dimension that
assumes it is always present. The transport sets it on the active context around its `fetch`
(`withA2aMethod`), and `onStart` reads it from the parent context the SDK passes; the request
body, which is the user's message, is never read for it.

**Only for a same-origin base.** When `AGENTIKO_API_BASE_URL` is absent, empty or on another
origin, A2A requests are handled exactly as before this span existed: renamed
`krateo.widget.fetch` and dropped at export for not being under the snowplow base. Cross-origin,
the request carries no `traceparent` (the propagation allowlist names snowplow only), so its span
would be an orphan root that joins nothing.

## How the names are enforced

snowplow accepts **only** the names it allowlists and drops anything else server-side. Auto-instrumented fetch
spans are named `HTTP GET` / `HTTP POST`, so without intervention every span the portal produces
would be dropped — and dropped **invisibly**, since the browser sees a 2xx and nothing arrives.

`ui/src/otel/spanContract.ts` therefore:

1. **renames** auto-instrumented HTTP spans to `krateo.widget.fetch` — or to
   `krateo.agentiko.a2a` when the URL is under the same-origin A2A base — on `onStart` (a
   `ReadableSpan`'s name is read-only by `onEnd`, so renaming there silently does nothing). The
   span is recognised by its `http.request.method` attribute, not by the library's name for it
   (#588);
2. **drops**, client-side, any span the contract does not name, any `krateo.widget.fetch`
   whose URL is not under the snowplow base, and any `krateo.agentiko.a2a` whose URL is not under
   the A2A base — snowplow would drop it anyway, but an
   unexportable span still spends the size and rate budget a real one needs;
3. matches on the **`SNOWPLOW_API_BASE_URL` prefix**, not an origin, and at a path boundary.

   An origin check is correct only where snowplow has an origin of its own. On a same-origin
   install — 057 serves portal, snowplow *and* authn from `portal.krateo.dev` — "same origin as
   snowplow" is also true of authn calls and of the SPA's own `/config/config.json`, so an origin
   check exports those as widget fetches. And the prefix must match at a path boundary: a bare
   `startsWith` on `…/content` also admits `…/contentious/call`.

   The propagator uses the same derivation, so "we inject `traceparent` here" and "we export spans
   from here" cannot drift apart. That also narrows propagation, which previously reached authn and
   events — a header with no counterpart, since only snowplow emits a Server span to link to.

## Privacy

Route templates, never raw URLs. No tokens, no query strings, no user names or display names.

Enforced **in the browser**, in each instrumentation's `applyCustomAttributesOnSpan` — the only
point where a span is still mutable, since by `onEnd` the attributes are frozen behind a
`ReadableSpan`. `redactUrlAttributes` strips the query from `http.url` / `url.full` and records
`http.route` relative to the snowplow base. `krateo.agentiko.a2a` goes further, at `onEnd`: it is
exported with a copy of the span carrying only its four allowlisted attributes, the span context
read through unchanged.

The query is the part that matters: `?extras={…}` carries whatever the user filtered or searched
for, and a page name is not ours to ship. snowplow allowlists attributes independently, but a value
it would reject is a value the browser should not have sent — the only copy that never leaks is the
one never transmitted. A test asserts that no exported attribute contains a `?`.
