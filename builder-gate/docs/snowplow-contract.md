---
type: Integration
title: builder-gate ↔ snowplow — the assumed contract
description: What the builder gate needs from snowplow to judge a draft against the live cluster as the caller, with no RBAC and no emulation of its own. ASSUMED, not yet confirmed by snowplow; none of it exists in snowplow 1.12.33.
tags: [builder-gate, snowplow, contract]
timestamp: 2026-10-03T00:00:00Z
---

# builder-gate ↔ snowplow: the assumed contract

**Status: ASSUMED.** The snowplow owners have not confirmed any of this yet, and none of it exists
in snowplow 1.12.33 (the installer pin). The gate's client is `src/snowplow.ts`, and its tests
(`test/dryRun.test.ts`, `test/data.test.ts`, `test/rules.test.ts`, `test/dryRunGuard.test.ts`)
run against an in-memory snowplow that speaks this document. When snowplow confirms the contract
or changes it, this file and `src/snowplow.ts` change together.

## Why snowplow

The gate is thin (#442). It lints, checks references and compiles jq itself, all of which are
static. Everything that needs the live cluster goes through snowplow **as the caller**, the person
the agent works for. The gate never acts as itself:

- It holds no RBAC beyond `get` on its own Builder CRs.
- It never re-implements RESTAction evaluation, which belongs to snowplow.
- Whatever it learns, the person could have learned through the portal.

The caller's identity is the Krateo JWT that kagent forwards on the MCP request
(`KAGENT_PROPAGATE_TOKEN`). The gate sends it as `Authorization: Bearer <jwt>` on every call
below, exactly as the portal does.

## 1. `GET /capabilities` — feature discovery

The gate asks this once per `validate_draft` call, before anything else live.

```http
GET /capabilities
Authorization: Bearer <caller JWT>

200 {"capabilities": ["call.raw", "call.dryRun", "resolve.inline"]}
```

- A capability that is not listed is treated as absent. A **404** means none (today's snowplow).
- **Load-bearing:** the gate sends a call from sections 2–4 only when its capability is listed.
  Today's snowplow ignores `dryRun` on `POST /call` and would **create the object for real**, so
  without the advertisement the gate sends nothing.
- When a capability is absent, the step that needs it reports `live verdict missing: …` and is
  **red** (#442 D9: no green without the API server's judgement).

## 2. `call.raw` — read an existing object, not resolved

```http
GET /call?apiVersion=<group/version>&resource=<plural>&namespace=<ns>&name=<name>&raw=true
Authorization: Bearer <caller JWT>
```

- **What it does:** returns the object as stored, using the caller's RBAC `get`. It does **not**
  resolve it: no widgetData template, no apiRef, and no RESTAction api calls run.
- **Why:** a resolving `GET /call` would run a RESTAction just to learn that it exists, and could
  pull Secrets into snowplow's cluster-wide informers. That is the hazard the portal's
  `lint-ra-secrets.py` documents.
- **Answers:** 200 with the object; 404 when it is missing; 403 when the caller may not read it.
  The body follows snowplow's usual Status JSON.
- **Who uses it:** the `references` step, for a reference that is not in the draft. It checks
  that the object exists. For a RESTAction, it also holds the stored spec to the secrets rule.

## 3. `call.dryRun` — the dry-run create

```http
POST /call?apiVersion=<group/version>&resource=<plural>&namespace=<sandbox>&name=<name>&dryRun=All&fieldValidation=Strict
Authorization: Bearer <caller JWT>
Content-Type: application/json

<the object, metadata.namespace = <sandbox>>
```

- **What snowplow does:** forwards **both** query parameters to the API server's create, as the
  caller. It returns the API server's status code and body unchanged: the object on 201, a
  `Status` on failure (422 `Invalid` for schema or CEL, 400 for a strict-decoding error, 403, 404
  …).
- **The confirmation the gate requires:** every 2xx carries the response header
  `X-Krateo-Dry-Run: All`. This states that snowplow forwarded the dry run. A 2xx without it is a
  contract violation, and the gate reports it as such (`the object may have been PERSISTED`),
  never as a pass.
- **Sandbox only:** the gate only ever names the preview sandbox namespace (`SANDBOX_NAMESPACE`,
  `krateo-preview`). The caller's own RBAC decides whether the create is allowed, as it does for
  the portal's preview.
- **Who uses it:** the `live-dry-run` step, one call per object, with the verdicts classified as
  `validated`, `rejected` or `notChecked`.

## 4. `resolve.inline` — resolve a RESTAction without storing it

```http
POST /resolve?dryRun=All
Authorization: Bearer <caller JWT>
Content-Type: application/json

{"namespace": "<sandbox>", "restAction": <the RESTAction object>}
```

- **What snowplow does:** resolves the RESTAction exactly as it resolves a stored one for this
  caller, and **persists nothing**: the api stages, the filters, userAccessFilter, endpointRef and
  the caches all behave as they would for a stored one. It answers 200 with the RESTAction, its
  `status` set to the output. On failure it answers a `Status`, with 4xx for a defect in the
  RESTAction and 5xx when it cannot run it.
- **The confirmation:** every 2xx carries `X-Krateo-Dry-Run: All`, the same rule as section 3.
- **Who uses it:** the `data` step, which reports a count and a short sample of `status` to the
  agent.
- **Secrets:** a RESTAction that could read Secrets never reaches this call. The gate's
  `builder-lint` refuses it first (`src/pages/secrets.ts`, ported from the portal's
  `lint-ra-secrets.py`).

## Open questions for the snowplow owners

1. **Naming:** the paths, the `raw` parameter, the capability names and the
   `X-Krateo-Dry-Run` header are proposals. Any shape works if it keeps the three properties
   below:
   - discovered before use;
   - confirmed on success;
   - nothing persisted.
2. **Inline resolve:** should it live under `/call` (as a `POST /call/read` sibling) rather than
   `/resolve`?
3. **Caches:** must the inline resolve bypass the identity-free apistage L1 cache? The draft is
   not a stored object, so it must not seed or read entries keyed as one.
