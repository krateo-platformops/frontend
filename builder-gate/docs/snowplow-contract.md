---
type: Integration
title: builder-gate ↔ snowplow — the contract (snowplow#443)
description: What the builder gate calls on snowplow to judge a draft against the live cluster as the caller, with no RBAC and no emulation of its own — snowplow#443's design, confirmed from the gate side on 2026-10-04, landing in snowplow 1.12.36.
tags: [builder-gate, snowplow, contract]
timestamp: 2026-10-04T00:00:00Z
---

# builder-gate ↔ snowplow: the contract

**Source.** This is the design comment on krateo-platformops/snowplow#443 ("#443 design: the
builder-gate contract"). The builder gate confirmed it on the issue, and it lands in **snowplow
1.12.36**. The gate's client is `src/snowplow.ts`. Its tests run against an in-memory snowplow
that speaks this document, plus an OLDER snowplow that does not.

**Pending snowplow PR #469** (#443 P2), which ships the following. The gate is written against
it, and its PR does not merge before #469 does:

- **`X-Snowplow-Stage-Outcomes`** on an inline resolve reply. See §4.
- **The `StageNotExecuted` reason** on a write-verb stage the inline resolve refuses to run. The
  documented message `dry-run: stage "<id>" verb <V> is not executed` is stable too.

## Why snowplow

The gate is thin (#442):

- It lints, checks references and compiles jq itself. All of that is static.
- Everything that needs the live cluster goes through snowplow **as the caller**: the person the
  agent works for, whose Krateo JWT kagent forwards on the MCP request (`KAGENT_PROPAGATE_TOKEN`).
- The gate holds no RBAC beyond `get` on its own Builder CRs, and re-implements nothing snowplow
  does.

## 0. The safety rules the gate keeps

1. **Capabilities by presence, never by version.** Each call below is sent only when
   `GET /capabilities` lists its token. A 404 means none.
2. **Dry-run writes go to `/call/dry-run` only.** An older snowplow (and an older pod mid-rollout)
   does not serve that route, so it answers 404 and **nothing is written**. Plain `/call` is only
   ever read (GET) by the gate. An older snowplow would treat a write there as a real create.
3. **A missing echo is a failure, never a pass.** Every reply the gate trusts carries its echo
   header. Without it, the reply judges nothing, and the step is red.

## 1. `GET /capabilities`

```http
GET /capabilities

200 {"capabilities":["call.dryRun","call.fieldValidation","call.raw","call.read.inline"]}
```

The response is static and unauthenticated, and contains only the tokens. `call.warnings` comes
later; the gate does not use it.

| Token | What the gate sends once it is listed |
|---|---|
| `call.dryRun` + `call.fieldValidation` | §2, the dry-run (both tokens are required: every dry-run carries `fieldValidation=Strict`) |
| `call.raw` | §3, the raw read |
| `call.read.inline` | §4, the inline resolve |

## 2. Dry-run: `POST /call/dry-run`

```http
POST /call/dry-run?apiVersion=<g/v>&resource=<plural>&namespace=<sandbox>&name=<name>&dryRun=All&fieldValidation=Strict
Authorization: Bearer <caller JWT>

<the object, metadata.namespace = <sandbox>>
```

- **What snowplow does:** the outbound apiserver call always carries `dryRun=All`. An inbound
  `dryRun` other than exactly `All` is a 400. `fieldValidation=Strict` is forwarded, and the
  request runs as the caller.
- **Echo:** `X-Snowplow-Dry-Run: All` and `X-Snowplow-Field-Validation: Strict`. These are on 2xx
  and on the apiserver's own failures, and absent on snowplow's validation 400.
- **How the gate reads the reply:**
  - **Echoed:** it is the apiserver's verdict. 201 and 409 AlreadyExists are `validated`; 422 and
    400 are `rejected`; 403, 401 and a missing sandbox namespace are `notChecked`.
  - **Not echoed:** `notChecked`, which is red, whatever the status. A 2xx without both echoes is
    reported as a contract violation: the object "may have been PERSISTED".
- **The gate only ever names the sandbox namespace** (`SANDBOX_NAMESPACE`, `krateo-preview`).
- **Known gap (snowplow side):** plumbing v1.14.2 truncates apiserver error bodies to 2 KiB, so a
  Strict 422 reaches the gate with `message` but without `details.causes`.

## 3. Raw read: `GET /call?…&raw=true`

```http
GET /call?apiVersion=<g/v>&resource=<plural>&namespace=<ns>&name=<name>&raw=true
Authorization: Bearer <caller JWT>
```

- **What it returns:** for RESTActions and the widgets group, the stored object, not resolved, as
  the caller. The apiserver's 403 and 404 are passed through. Other kinds already return the
  stored object on `GET /call`.
- **Echo:** `X-Snowplow-Raw: true`. The gate requires it on 200, 403 and 404. A reply without it
  may be a resolve, so the lookup fails.
- **Who uses it:** the `references` step, for references outside the draft. An existing
  RESTAction is also held to the secrets rule.

## 4. Inline resolve: `POST /call/read`

```http
POST /call/read?apiVersion=templates.krateo.io/v1&resource=restactions&namespace=<sandbox>&name=<name>
Authorization: Bearer <caller JWT>

{"extras":{},"object":{<the RESTAction, metadata.namespace = <sandbox>>}}
```

- **What snowplow does:**
  - It uses the same resolver entry as a stored RESTAction; only the spec's source changes. The
    reply is the same envelope, with the output in `.status` and per-stage errors included.
  - It runs as the caller end to end. endpointRef Secrets and userAccessFilter stages are read as
    the caller too.
  - It persists nothing: no cache, informer, SSE or refresher contact.
  - Write-verb stages are **not executed**; each gets a per-stage error.
- **Validation (each failure is a 400):** body ≤ 1 MiB; RESTAction only; and metadata name and
  namespace must equal the query.
- **Echo:** `X-Snowplow-Dry-Run: All` and `X-Snowplow-Resolve-Source: request-body`, set before
  the first byte, so they ride a 2xx, a stage-error 200 and a filter 500. An older snowplow ignores
  `object` and resolves the STORED RESTAction with no echo, so a reply without both echoes fails.
- **Stage outcomes:** `X-Snowplow-Stage-Outcomes` (snowplow PR #469, `stage_outcomes.go`) is
  compact JSON in topological stage order:
  `[{"name":"<stage>","ok":true},{"name":"<stage>","ok":false,"reason":"<code>"}]`.
  - It is never set on a stored resolve, and never carries a message, a path or data.
  - `reason` comes from a CLOSED set:
    - `StageNotExecuted`: a write-verb stage, refused;
    - `Forbidden`;
    - `NotFound`;
    - `Unauthorized`;
    - `NotRun`: the resolve stopped (truncated) before this stage;
    - `Error`: anything else.
  - Above 4 KiB the header is `{"truncated":true,"failed":N}`.
  - A refused write-verb stage that is not `continueOnError` is a hard failure, so snowplow stops
    the resolve there. Every later stage in topological order then reports `NotRun`, whatever its
    `dependsOn`.
- **v1 scope:** drafts referencing other drafts are not supported (nested references resolve
  stored objects), so the gate resolves each draft RESTAction on its own.
- **What the gate does with the reply:**
  - **Stage outcomes come from the header, the PRIMARY source.** Unlike the body, no
    `spec.filter` can drop it. Each failed stage, in header order:
    - **Note:** reason `StageNotExecuted`, or a body message matching the documented
      `dry-run: stage "<name>" verb <V> is not executed`. Reads "not executed by design: checked at
      the driven Preview".
    - **Note:** a stage the draft marks `continueOnError` (matched by name). Reads "continueOnError,
      the page is expected to cope; checked at the driven Preview".
    - **`NotRun`:** its cause is the nearest earlier failed stage, the one where the resolve
      stopped. It is a note when that stage is a note, and red otherwise. With no earlier failed
      stage, it is red.
    - **Red:**
      - a reason outside the closed set, or none ("unknown reason");
      - any other failed stage;
      - a truncated header;
      - a missing or malformed header, which is a contract violation.
    - The body's per-stage error messages (each stage's `errorKey`, default `error`, in `.status`)
      are read only for the message fallback and as detail.
  - **Secrets, second layer:** snowplow reads Secret paths live as the caller and does not refuse
    them (the #398 ruling). The gate's static rule (`src/pages/secrets.ts`) already refuses any
    draft that could read them. Beyond that, the gate drops anything Secret-shaped from the output
    before it enters the envelope, and notes the drop. Secret-shaped means:
    - `kind: Secret`; or
    - a `data` map of base64 values under an object with `type`, `metadata`, `stringData` or
      `immutable`.
  - **The sample:** what reaches the agent is a count and a short sample of `.status`.

## 5. RBAC

Everything above runs as the caller. The gate's ServiceAccount holds only `get` on its own
Builders, and the snowplow chart's RBAC is unchanged.
