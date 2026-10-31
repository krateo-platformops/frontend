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
| `krateo.page.publish` | yes | publish confirmed | the published state is visible |
| `krateo.page.load` | **no** | document load | — |
| `krateo.widget.fetch` | no (a child) | one portal → snowplow request | its response |

### The rule the boundaries come from

**A span measures what the user waits for: from committed intent to visible outcome.** Time the
user spends thinking or confirming is not ours.

Three consequences that are easy to get wrong, each of which would have *flattered* the p95:

- **A validation failure produces NO span.** The user never waited on us, and counting a cheap
  client-side rejection as a fast interaction would improve the percentile by doing less.
- **`composition.open` ends when every initial widget has resolved, not at first paint.** An empty
  shell is not "open". First paint is the number that would have looked best.
- **Abandonment is marked, not dropped.** Navigating away before the end ends the span with
  `krateo.interaction.abandoned=true`, excluded from latency but still counted — a silently missing
  span hides the abandonment rate.

### Errors

Recorded, never dropped: span status `ERROR` plus the HTTP status attribute. Latency is computed
over OK spans and the error rate separately, so a fast failure cannot improve the p95.

### Linking

The `krateo.widget.fetch` spans an interaction causes are its **children**, in the same trace, and
carry W3C `traceparent` to snowplow — which emits its own Server span. So one trace shows
interaction → fetch → server, and an interaction that took 2.4s can be attributed rather than
merely observed.

## How the names are enforced

snowplow accepts **only** these five and drops anything else server-side. Auto-instrumented fetch
spans are named `HTTP GET` / `HTTP POST`, so without intervention every span the portal produces
would be dropped — and dropped **invisibly**, since the browser sees a 2xx and nothing arrives.

`ui/src/otel/spanContract.ts` therefore:

1. **renames** auto-instrumented HTTP spans to `krateo.widget.fetch`, on `onStart` (a
   `ReadableSpan`'s name is read-only by `onEnd`, so renaming there silently does nothing);
2. **drops**, client-side, any span the contract does not name, and any `krateo.widget.fetch`
   whose URL is not on an origin we export for — snowplow would drop it anyway, but an
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
`http.route` relative to the snowplow base.

The query is the part that matters: `?extras={…}` carries whatever the user filtered or searched
for, and a page name is not ours to ship. snowplow allowlists attributes independently, but a value
it would reject is a value the browser should not have sent — the only copy that never leaks is the
one never transmitted. A test asserts that no exported attribute contains a `?`.
