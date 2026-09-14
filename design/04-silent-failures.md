# Layer 4 — Silent failures

Every rule up to here describes something a reviewer could see. This class is different: **these defects pass every check that exists.** The CRD validates, the dry-run reports success, the widget renders, no error appears — and the page still does not do what its author declared. No mockup comparison finds an inert row, because an inert row looks exactly like a working one.

## Why the class exists

One fact explains most of it, and it is the most important thing to know when authoring these pages:

> `kubectl apply --dry-run=server` validates **static `widgetData` only**. It never validates `widgetDataTemplate` output, which snowplow evaluates later, at resolve time.
>
> — *the gap every silent failure falls through*

A template emitting the wrong *shape* — a string where the schema wants an array — is accepted at apply time and fails in the browser. A `Card.legend` given a string instead of swatches reported **“84/84 created, 0 errors”** and then rendered *“Error while rendering widget”* on a live page.

The second mechanism is strictness working against you. Widget CRDs are strongly typed with no `x-kubernetes-preserve-unknown-fields`, which is correct — but it means an unknown field on an *existing* schema is **silently pruned**, not rejected. A misspelled property vanishes, and the CR on the cluster is not the CR you wrote.

> **Correction to an earlier version of this document**
>
> This document previously stated that `allowedResources` is “a real containment grammar enforced by CRD validation.” **That was wrong, and the precise shape of the error matters.**
>
> The CRD *does* validate the field: it is required, and its values must come from a fixed enum of plural kind names. What it never does is connect that list to anything — `resourceRefId` is declared `type: string`, and no `x-kubernetes-validations` rule relates the two. The renderer doesn’t check either: it resolves the child and renders whatever `kind` comes back.
>
> So the API server verifies you spelled the *allowed list* correctly, and never checks what you put in `items`. The field looks validated — it *is* validated — just not for the thing it exists to express. That is why nobody noticed.
>
> It also settles where the rule belongs. A CEL rule cannot fix this, because the API server cannot resolve a `resourceRefId` to a kind at admission time. It can only ever be a **static lint across the chart**, where the reference and its target are both visible in one tree.

## The rules

### X1 — A render-time throw must not be able to blank the page.

**Status:** severe → **fixed**

> **Resolved since this rule was written.** `WidgetErrorBoundary`, scoped per widget, with `resetKey={dataUpdatedAt}` so a refetch un-latches it. Landed in PR #196.

**No React error boundary exists anywhere in the app** — zero matches for `componentDidCatch`, `getDerivedStateFromError` or `ErrorBoundary` across `ui/src`, on React 19.1.0, whose default on an uncaught render error is to unmount the tree.

The existing error card only guards the fetch and HTTP paths. So malformed-but-successfully-fetched data reaching a component that assumes a well-formed shape — the `Card.legend` case exactly — doesn’t produce the polished error card the app otherwise commits to. It produces a blank page.

*Evidence: independently verified on `origin/main`*

### X2 — “Denied”, “not found” and “broken” must be distinguishable.

**Status:** severe → **fixed**, residual **decided**

> **Resolved, and the residual is a decision rather than a gap.** 403 and 404 now render distinct calm states (#196).
>
> RBAC-denied child `resourcesRefs` remain filtered before any widget sees them, so a denial still reads as absence — and that is now **deliberate**. The alternative, announcing “3 items hidden by your permissions”, leaks the existence and count of resources outside a tenant’s scope, which is worse than the ambiguity it removes. Recorded so this is not re-filed as a defect.

> **Resolved since this rule was written.** 403 and 404 now render distinct calm states (`WidgetForbidden`, `WidgetNotFound`) rather than the red cross. Landed in PR #196. **Still open:** RBAC-denied child `resourcesRefs` are filtered before any widget sees them, so a denial can still read as absence.

Only 401 and the timeout statuses are special-cased. A **403 renders the identical card as a 500**, differing only by a status substring inside a free-text sentence.

Worse, one level up: RBAC-denied child `resourcesRefs` are filtered out *before any widget sees them*. A `List` with `hideWhenEmpty` then removes the box entirely — so a denial is not “you can’t see this”, it is **absence**.

On a platform where per-user RBAC scoping is a feature, a user with partial permissions sees a page that looks complete and is not. This is a trust property, not a styling one.

*Evidence: verified `useWidgetQuery.ts:194-204` · `WidgetRenderer.tsx:66,144-157` · `ListView.tsx:88-91`*

### X3 — A failed fetch surfaces the backend’s own explanation.

**Status:** gap → **fixed**

> **Resolved since this rule was written.** `WidgetFetchError` now carries a `detail` read best-effort from the failure body, and the renderer prefers it over the generic HTTP phrase. Landed in PR #196.

On a non-OK response only `status` and `statusText` reach the UI — a generic phrase like “Forbidden”. The response body is never read, so any backend-provided message is discarded. The app plainly *can* show detail: the malformed-status branch a few lines away dumps name, namespace, version, endpoint and the whole widget JSON.

Combined with P16, the most-travelled error path in the product discards the real cause, renders every failure identically, and apologises.

*Evidence: verified `useWidgetQuery.ts:203-204` vs `WidgetRenderer.tsx:199-215`*

### X4 — The same authoring mistake produces the same visible result in every container.

**Status:** gap

A `resourceRefId` with no matching `resourcesRefs` entry behaves **three different ways** depending only on which container it sits in:

| Container | Result | Visible to the author? |
|---|---|---|
| Row · Col · Flex · Card | child silently dropped, console error only | no |
| Table | renders an inline dash per cell | ambiguous — same as an empty value |
| Tabs | a visible `Result status="error"` naming the bad ref | yes |

`Tabs` is the only one that tells you.

> **Re-measured 2026-09-14, and the prescription below was unsafe as written.** This rule used to
> end "its behaviour should be the contract" full stop. Adopting that literally would have broken
> [X2](#x2), and the conflict is not visible from either rule on its own.

**Why it cannot simply be lifted everywhere.** `WidgetRenderer.tsx` strips every `allowed: false`
ref *before any container sees it*, so at the widget layer **an RBAC-denied child is byte-identical
to a typo'd ref**. Making all containers loud would therefore announce denied resources on every
partially-permitted page — which is exactly the leak X2 decided against, where a denial reading as
absence is the deliberate position. Any fix has to distinguish the two *above* the container, or it
trades a silent-failure bug for a disclosure bug.

**The count is also wrong.** It is not three behaviours across 7 containers but **four across 13
container call sites**, plus 2 non-container consumers. `PageHeader` is a fourth behaviour the table
misses — `null` plus a bespoke named `console.error` carrying an explicit "loud rather than silent"
comment, and the only test in the repo covering any of this. `Steps` degrades silently to plain
text. `Menu`/`navModel` hides the entry *deliberately* for RBAC and must keep doing so. Six further
silent call sites go unmentioned: `ButtonGroup`, `Filters`, `Form`, `Layout`, `List`, and two more
inside `Card` itself (`FooterItem`, and the `cover`/`extraRefId` slots).

**Shape of the fix, when it is taken.** A shared `RefChild` that resolves and renders the failure,
so the 11 `getEndpointUrl` + `if (!endpoint) return null` + `.filter(Boolean)` sites collapse to one.
It needs **two densities, not one**: a full `Result` is right for a tab or a page section and would
destroy row height inside a `Table` cell, where the answer is a compact marker carrying the id in a
tooltip — today a bad ref there renders the same `-` as a genuinely empty value, at five other call
sites in the same file. And `getResourceRef`/`getEndpointUrl` themselves have **zero test coverage**,
which is where any change should start.

*Blocked on a decision, not on effort: how to separate a denied ref from an absent one before it
reaches a container.*

*Evidence: verified `utils.ts:3-18`, `Row.tsx:38-41`, `Col.tsx:24-28`, `Flex.tsx:17-21`, `Card.tsx:210-218`, `Table.tsx:157-165`, `Tabs.tsx:18-32`*

### X5 — Containment is checked by a chart lint, since nothing else can check it.

**Status:** gap → **enforced** — and it found a live defect on its first run

The containment FIELD is a common contract maintained by the CRD generator
(`normalizeAllowedResources`), and the DECLARATION is now checked by
`containment` in `lint-portal-consistency.py`.

**First run: 16 violations, all in one file.** `menu.sidebar-nav` declared
`allowedResources: [navmenuitems, pages]` — both kinds removed in the routing refactor — while
holding 14 page-root Flexes. It named two things that do not exist and excluded the one thing it
contains, and it rendered correctly the whole time, because nothing enforces the declaration at
runtime: not OpenAPI, not a webhook, not the renderer.

The lint checks against the CHART, not a frozen list: a child's real plural comes from its own
`resourcesRefs` entry, so this cannot go stale the way the per-widget enums did.

Two deliberate non-reports. A container with NO `allowedResources` is unconstrained, which is a
legitimate authoring choice — only a declaration that is CONTRADICTED is a defect. And templated
`items` are skipped, since a resolve-time list is not knowable statically (the same exclusion
`dangling-ref` makes).

The containment FIELD is now a common contract, maintained by the CRD generator rather than
per-widget by hand (`normalizeAllowedResources` in `gen-crds.ts`, alongside the existing
`injectKeyExtras`/`injectFreshness` post-processors). Every container carries it — 14 of them,
including the six that previously declared nothing (`Breadcrumb`, `Card`, `Descriptions`,
`Filters`, `Form`, `Steps`) and `Table`, which resolves children through cells rather than `items`
and so was missed by the first pass.

**The per-widget enums are gone, and they had earned it.** `Flex` listed 28 kinds, `Col`/`Row` 23,
`Table` 11, and `Menu` exactly two — `navmenuitems` and `pages` — BOTH removed in the routing
refactor. Nothing distinguished design from drift, adding one widget kind meant editing six frozen
lists by hand, and the enum enforced nothing at runtime: no runtime code reads `allowedResources`
at all. The one non-type reference in the codebase is a comment in `PageSearch.tsx` recording that
the component could not be used as a `Flex` child *because* `inputs` was missing from the enum —
so the only measurable effect it ever had was blocking legitimate composition.

**What this made urgent:** removing the enum removed the only cluster-side containment check that
existed, leaving the lint as the SOLE enforcement. **That lint now exists** — `rule_containment` in
`lint-portal-consistency.py`, registered as `containment`/X5, run against the rendered chart by the
portal's `design-system` workflow and covered by the self-test's derived rule list. It is better
than what it replaced, as predicted: it checks each declaration against the child's real plural as
the chart itself declares it, rather than a list frozen at schema-authoring time.

> **This paragraph read "The lint is now the SOLE enforcement, and it does not exist yet" for
> several releases after it was built** — inside a rule whose own status line two screens up already
> said `enforced`. A rule that contradicts itself top to bottom is worse than one marked stale.

`allowedResources` is enforced by nothing at runtime — not by OpenAPI, not by a webhook, not by the
renderer. The lint is the only thing that reads it back.

Two structural oddities the lint would also surface: four containers (`Card`, `Steps`, `Layout`, `Form`) resolve children just as dynamically and declare **no** `allowedResources` at all, with no principle separating them from the seven that do; and `Menu`’s enum names two kinds — `navmenuitems`, `pages` — that the registry documents as **removed** in a routing refactor. Dead values in a live enum.

*Evidence: verified: no `x-kubernetes-validations` in the widget CRDs · `WidgetRenderer.tsx:73-76` · `Col.crd.yaml:156-197`*

### X6 — Recursive rendering has a depth bound.

**Status:** gap → **fixed**

`context/RenderChainContext` threads the chain of endpoints being rendered, and `WidgetRenderer`
checks it BEFORE fetching — a cycle should cost zero requests, not one per turn of it.

Two bounds, because they fail differently. A REPEATED endpoint is a cycle and can be named
precisely: *"This widget and `card-a` reference each other, so rendering one renders the other
forever"* — which is the only thing a chart author can act on. A merely very deep chain gets a cap
(32) with a vaguer message.

**The cap is calibrated, not guessed.** A DFS over all 511 CRs and 450 child edges in the portal
chart finds zero cycles and a deepest real chain of NINE levels, so 32 leaves ~3.5x headroom over
the deepest composition anyone has authored.

Worth stating plainly, because it is what makes this class dangerous: **a cycle is two CRs each
naming the other, in different files, each correct in isolation.** Nothing in the CRD, the server
dry-run or the chart lint can see it — neither CR is wrong on its own. Before this, the render path
found it by exhausting the browser's stack.

No nesting-depth or cycle guard exists anywhere in the render path. A self-referencing or mutually-cyclic `resourceRefId` chain has nothing between it and a browser stack overflow.

*Evidence: verified: no depth parameter threaded through `WidgetRenderer`’s parse or render path*

### X7 — A CRD-sourced form schema is passed as a string, so field order survives.

**Status:** gap → **partly adopted, and one live defect found by it**

3 of the 10 `apiRef`-backed forms pass their schema as a string; the rest use `schema` and accept Go's map-sort order. Whether each of those seven NEEDS order preservation is a per-form question nobody has asked.

Applying this rule found a real defect: `form.agents-policy-create` declared an `apiRef` and had **no `widgetDataTemplate` at all**, so the 10,349-character action that builds its field set was never consumed and `schema: {}` stayed empty — the page rendered an error state below a correct header. An audit of all 11 form CRs confirmed it was the only one.

The mechanism ships and works: the Form prefers `stringSchema`, whose raw JSON preserves key order, over the parsed object. But it is **opt-in** — a Form given only `schema` alphabetises its fields silently, because CRD `openAPIV3Schema` properties arrive from a Go map. No error, just the wrong order.

*Evidence: verified `Form.tsx:170-187` · `SchemaFields.tsx:143-149`*

### X8 — Layout maths runs on the children that survive, not the ones declared.

**Status:** narrow

`Row` computes its default column span from the raw item count *before* unresolvable children are filtered out — so one broken child leaves dead grid space instead of the survivors redistributing to fill the row.

*Evidence: verified `Row.tsx:24` computed ahead of the filter at `:65`*

## What this class demands of enforcement

A static lint catches the decidable half — an empty placeholder feeding a route, a field absent from the schema, a dangling ref, a missing `keyExtras`. It cannot catch shape errors in template output, because that output does not exist until snowplow runs.

Closing that properly means validating **resolved** widget data against the CRD schema, after the template is evaluated and before the page is served. Until that exists, the honest mitigation is narrower: keep computed values *inside* the shape the static default already declares, so a template changes content and never structure. A `tags: []` default the template fills with strings is safe; a `legend` default the template replaces with a different type is the bug above.

One caution from a failed attempt: a static check written for the `legend` class produced **23 false positives against 1 real defect** and was deleted. Scope each check to what is statically decidable — a noisy lint gets removed, and takes the signal with it.

### X9 — A same-path navigate merges into the params already on the URL.

**Status:** holds

**Corrected — this was published as a defect and is not one.** The audit reported that `setExtras` discards every URL param it did not set, because `buildExtrasPath` builds a fresh `URLSearchParams` of whitelisted keys only and appends it to the bare pathname. Read in isolation that is exactly what it looks like.

The merge happens one layer down, in the shared dispatcher every navigate passes through: `resolveNavigationTarget` seeds from `window.location.search` and overlays the target's params whenever the pathname matches — which `buildExtrasPath` guarantees, since it always targets the current pathname. It is bare *because* the dispatcher restores the rest, and its own comment says so.

This is the rule the arrangement encodes, and it is the right one: **an independent filter control emits only its own param** — the status chips `?status=`, the range chips `?range=` — and composition is the dispatcher's job. Any control that emitted its siblings' params too would clobber them on every click.

Worth keeping as a rule for a second reason: **nothing demonstrated it.** No test referenced `resolveNavigationTarget` at all, despite every composable filter on every list page depending on it. That is why the misreading was reasonable, and why a plausible fix would have double-merged. Now pinned by four tests at the seam where the behaviour actually lives.

*Evidence: verified `useHandleActions.ts:121-135,735` · `verbRegistry.ts:79-91` · pinned by `resolveNavigationTarget.test.ts`*

### X10 — A filter the backend still honours must have a control, or be removed from the backend too.

**Status:** defect → **fixed**

> **Fixed** (portal#151). The orphaned control and its container are deleted and the RESTAction no longer filters on `.range`/`.from`/`.to`; the sibling chips stop carrying them. Verified before deleting that the only navigation to `/compositions?range=` came from the orphaned control itself. The dashboard is untouched — it has its own action and its own range chips.

On `/compositions`, `listy.compositions-range-chips` and `rangepicker.comp-date-range` are referenced by nothing, and `flex.compositions-range-group` is marked *“SUPERSEDED / UNREFERENCED”* — yet `restaction.compositions-list` still filters on `.range`/`.from`/`.to`. **Autopilot can time-scope that list where a user cannot.** A dead control plus a live filter is a parity gap created by deletion.

*Evidence: verified on the chart at origin/main*

### X11 — A widget kind the frontend no longer resolves renders nothing at all.

**Status:** enforced

The antd-fidelity migration was a HARD BREAK with no aliases — `Panel`→`Card`, `DataGrid`→`Listy`,
`Column`→`Col`, `TabList`→`Tabs`, `NavMenu`→`Menu` — and the routing kinds (`Page`, `Route`,
`RoutesLoader`, `NavMenuItem`) were removed outright when routing became data. A CR on a dead kind
renders nothing: `getWidgetModule(kind)` returns undefined.

It matters most in the charts nobody opens, which is exactly where a dead kind survives longest.

*Enforced by `dead-kind` in `lint-portal-consistency.py`.*

### X12 — `resourcesRefs` is an object, and a chart using the bare-list form does not apply at all.

**Status:** enforced

The current CRD declares `resourcesRefs` an object (`{items, slice}`). A chart still using the
legacy list form fails validation before a single widget renders — so unlike most rules here the
failure is loud, but it is loud at DEPLOY time, in a chart that looked fine in review.

*Enforced by `legacy-envelope` in `lint-portal-consistency.py`.*

### X13 — A `resourcesRefs` entry naming a CR that does not exist is the deletion hazard.

**Status:** enforced — and it found a shipped defect on its first run

X4 checks the other direction: an `items[]` id with no `resourcesRefs` entry. (This said "X1" for a
long time; X1 is the render-time error-boundary rule, and the `dangling-ref` lint rule is mapped to
X4.) Both are needed,
because they fail differently. This one is what deleting a CR leaves behind: remove the CR, leave a
reference to it somewhere else, and the parent renders **without that child** — `Row`/`Col`/`Flex`/
`Card` drop it with only a console message. Nothing in the chart complains and the page just says
less than it used to.

It was written for the PageHeader migration, which deletes 3–6 CRs per page across 25 pages. On its
first run against the portal chart it found a defect that had already shipped: #149 had committed
the alert-detail pipeline walk's RESTAction and its page reference but not the `Card` and `Markdown`
that render it, and the page had been showing nothing in that slot.

Two things make it work where a naive version would not. Kind→plural comes from the real CRDs
rather than a hardcoded table — a table would have gone stale the day `PageHeader` was added — and
the primary check is plural-INDEPENDENT, so it still works in a repo with no CRD checkout and in CI
with no cluster.

**What it cannot see:** a reference and its target behind the SAME helm conditional. On
`/observability` both the header's `items` entry and the Button's own CR sit behind
`{{- if .Values.observabilityConsoleUrl }}`, so neither looks dangling to a static reader. That
case is checked by rendering both branches, by hand.

*Enforced by `missing-target` in `lint-portal-consistency.py`.*
