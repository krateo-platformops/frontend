# Layer 3 — Composition rules

These govern how a page is assembled from widget CRs. Over half the recommended fixes in the backlog were marked “CR-only”, and this layer had no contract at all — [#57](https://github.com/krateo-platformops/frontend/issues/57) is its only precedent, written because *“this portal is the pattern future CR implementations will copy.”*

## Page structure

### P1 — One way back. The breadcrumb is it.

**Status:** CR

Never add a `← Back to X` link. Filed four times, on four pages, with an identical fix each time — the cleanest illustration in the set of a missing contract.

*Evidence: #69 §0.2 · #78 §0.2 · #82 §0.4 · #83 §0.3*

### P2 — No eyebrow label above a page title.

**Status:** CR

“CONSOLE”, “CATALOG” and similar were each removed individually. The title names the page; the eyebrow restates the nav.

*Evidence: #80 §0.3 · #82 §0.2*

### P3 — Say it once per page.

**Status:** CR

A tab’s `title` must not restate its own content heading; a subtitle must not repeat the title. Ten findings across seven issues are variations of this.

```
# tabs.obs-main.yaml — #83 §0.1
items:
  - label: Reconciliation
    title: Composition health from live cluster snapshots  # verbatim duplicate of the section below
```

*Evidence: #69 §0.5 · #72 §0.1 · #82 §0.3 · #83 §0.1*

### P4 — Counters sit beside the title, in brackets, on the title’s own type step.

**Status:** CR

*Evidence: #82 §0.3 · #86 §0.3*

### P5 — Toolbar: filter chips left, search right, one line. Chip groups stack as left-aligned rows.

**Status:** CR

Seven findings across five pages.

*Evidence: #75 §0.2 · #79 §0.1–0.2 · #80 §0.1 · #82 §0.1 · #86 §0.4*

### P6 — One primary action per container — a page header *or* a self-contained panel.

**Status:** CR

**Rescoped.** This previously read “per header”, which was too narrow: the same discipline is already applied at panel level, and #86 §0.9a treats an Alert-detail panel as its own primary budget independent of the page header.

The rescoping also resolves the apparent conflict with the Autopilot CTA. That button is **not** special-cased: it competes for the same single slot as any other button in its container, is never automatically primary for being Autopilot, and is never barred from being primary either. See A5.

*Evidence: #78 §0.4 · #84 §0.1 · #86 §0.9 — rescoped by the parity audit*

### P7 — Don’t spend two panels on two facts.

**Status:** CR

Twelve findings across seven issues. Collapse a thin second column into the first; keep a split only when both columns carry a real section.

*Evidence: #69 §0.9 · #72 §0.7 · #78 §0.5 · #80 §0.2 · #82 §0.6 · #86 §0.7*

### P8 — Tabs when the reader comes for one; stacked sections when they need more than one.

**Status:** CR

The discriminator is not how many sections there are — it is whether a single visit needs more than one of them. Alert detail stacks, because the pipeline walk, the config panel and the linked incident are one story about one object. The agents page tabs, because a visit wants the inventory *or* the topology, never both.

Three tests for the ambiguous middle: would anyone **compare** two of them (tabs make that impossible)? Is there an **obvious default** (if not, the first tab is an arbitrary decision nobody made)? Are they **short** (stacking beats a click)?

Two costs to accept before choosing tabs. **Deep-linking is one-way:** `?tab=Telemetry` lands on a tab, but the widget is uncontrolled, so switching does not update the URL — you can link into a tab, you cannot share the tab you switched to. And **hidden content is unsearchable** — Ctrl-F finds nothing on an inactive tab.

A third option is often the right one: if the sections are genuinely different subjects rather than facets of one, they want their own **pages and nav entries**. Tabs are for the same subject at the same level.

Observed practice backs this: only 4 of 612 CRs use Tabs, in two shapes — page-level alternatives (`obs-main`: Reconciliation / Telemetry / Components) and panel-level views of one object (`incident-why`: Reasoning trace / Verdict / Gaps). Everything else stacks.

**Diagnostic:** if you are reaching for a divider, ask whether those sections belong on the same screen at all. The agents page was reported as “sections are not clearly divided” — they were not under-separated, they were wrongly co-located.

Mechanical note: the `Tabs` enum carries `cols` but not `flexes`, so a section built as a `Flex` needs a one-level `Col` wrapper. `Col` does allow `flexes`.

*Evidence: verified on origin/main: `Tabs.tsx:45-62` (uncontrolled `defaultActiveKey`, `?tab=` honoured) · 4 Tabs CRs across 29 page compositions*

### P9 — Vertical rhythm between page sections keys off one spacing step.

**Status:** open → **closed** — one step, `middle` (8px), across all 31 roots, lint-enforced

#54 §0.6 asked for a standard gap between major sections and a smaller one within a section. No shared page-rhythm convention exists, so each page's section gap stays ad hoc.

> **Corrected.** This rule used to justify itself with "with no `PageHeader` (C5)". C5 has been
> built and adopted for some time — the chart renders 28 `PageHeader` CRs — so as written the rule
> told a reader that a component with 28 shipped instances was missing. The gap is real; that
> particular reason for it is not, and a rule that argues from a false premise is easy to dismiss
> for the wrong reason.

> **Re-measured 2026-09-14.** This rule described the convention as non-existent after
> [#192](https://github.com/krateo-platformops/portal/pull/192) had already chosen one. All 31 page
> roots are vertical `Flex` CRs, enumerated by walking the nav the way the P25 lint resolver does —
> 26 in `helm/portal`, 5 in `helm/portal-agents`. Distribution **today: `middle` 25, `large` 6**;
> nothing else, no numeric gap, no `gutter`, no inline margin. Before #192 the same 31 split
> `middle` 16 / `large` 13 / `small` 1 / unset 1.

**The value in px, because the label misleads.** Both themes apply antd's `compactAlgorithm`, which
halves the size ramp, so `middle` is **8px here, not the 16px antd documents** — `spacing.sm`,
`--krateo-space-2`. `large` is 16px, `spacing.md`, `--krateo-space-4`. Both land exactly on scale;
nothing measured is off-scale. Anyone reading "middle" against antd's own docs will reason from the
wrong number, which is why the px belongs in the rule and not just the label.

**The question this rule sat on, and what settled it.** `middle` is 8px while a card grid inside a
section sits on `Row`'s hardcoded 16px gutter, so sections are *closer together* than the cards
inside them. That looks like an inversion, and the obvious fix is to loosen the section gap to 24px.

**[G10](06-composition-patterns.md) settles it the other way, and G10 wins:** *"Spend vertical space
on rows; spend almost none on the frame around them. When a page feels cramped, the fix is nearly
always removing chrome, not loosening data."* The gap between sections **is** frame. The 16px between
cards is closer to data. So thin-frame-around-looser-data is not an inversion to fix — it is G10
working as intended, and loosening the section gap would have spent the density budget in exactly
the place G10 names as wrong.

> This was nearly decided the other way from a generic layout principle (between-section should
> exceed within-section) applied without checking whether this product had a stated position on
> density. It does — G10, plus `flex.dashboard-flex.yaml`, which records the dashboard being
> deliberately tightened "so the dashboard reads closer to the dense one-screen mockup". A design
> system exists to answer this kind of question; the failure mode is not consulting it.

**Landed:** the 6 remaining `large` roots moved to `middle`. Each had a local reason — `page-access-detail`
cited #88 §0.6, "the Cards' own padding plus the larger inter-card gap give the visual separation" —
and those reasons are exactly what one shared step overrides: the Cards' own padding carries the
separation, and the gap between them is frame.

**Enforced** by `lint-portal-consistency.py` rule `section-rhythm`, which reuses P25's nav-walk via
the shared `page_roots()` resolver — the 6 stragglers are precisely the roots a name-shaped survey
misses, and two rules re-deriving "what is a page root" independently is how that count went wrong
four times. A root declaring no `gap` is reported too: inheriting a default is not a decision.

The **within-section** step is `small`/4px, already used by 24 of the 56 non-root Flex CRs. P9 does
not govern it — rhythm *between* sections is the page's business, *within* one is that section's.

> Coverage caveat worth keeping: the agents pages are gated behind `.Values.agents.enabled`, which
> defaults off. Rendered with defaults, the nav declares 26 roots and the lint silently judges 26 of
> 31. Render with `--set agents.enabled=true` or the rule under-reports without saying so.

*Evidence: #54 §0.6 — the rhythm convention is still unresolved; the C5 dependency is not*

### P25 — Every page the nav declares opens on a `PageHeader`.

**Status:** gap → **fixed**

A page names itself, in the same place, in the same type ramp. It is the most visible consistency
rule here — and until the lint gained P25 the only thing enforcing it was someone running a survey
and counting.

Those surveys were wrong three times, and each new one inherited the previous blind spot, because
each looked for the *shape a page header was expected to have* rather than for the page:

| method | what it missed |
|---|---|
| by name (`pageheader.*`, `*-header-block`) | `/agents/{ns}/{name}` and `/alerts/{ns}/{name}`, which spell their parts `-titleline` |
| one document per file | `/marketplace/{name}` — `marketplace-detail.yaml` holds fifteen documents and opens with a RESTAction, so the file was classified as a RESTAction and its five-CR header never seen |
| first child must be a container | `/builderdemo`, which opened on a bare `Paragraph` |
| **this rule's own first draft** | every page whose `items` are assembled by a jq template — 5 of 31 routes. It returned a `templated` sentinel and the caller treated it as a PASS. Every detail page in this chart is authored that way, so the exemption landed exactly on the page class the rule existed for, including the same two `-titleline` pages the first survey missed |

Each method also produced a *confident count*, which is what made the error durable: "25 of 26
migrated" was reported three times, from three parsers that shared a blind spot — and then a fourth
time by the lint written to end the counting, which reported `0 violations` while two pages had
never been migrated at all.

The fourth one is the instructive one, because it was written *in response* to the first three and
still reproduced the family: it looked for the shape a page was expected to have (a static `items`
list) and treated everything else as fine. **A rule that cannot read a case must say so, not pass
it.** P25 now recovers the first child from the template's own first `resourceRefId` literal, and
reports a page it genuinely cannot read as undetermined rather than clean.

P25 therefore starts from the **nav**, which is what actually makes something a page, and resolves
the first child the way the renderer does — `widgetData.items[0]`'s `resourceRefId` through the CR's
own `resourcesRefs`. It cannot go stale against a naming convention, and a page added tomorrow is
covered without anyone remembering to re-survey.

The opt-out is an annotation on the page root, `krateo.io/no-page-header: <reason>`, so an exception
has to be written down where reviewers see it. `page-access-detail` carries the only one: it
resolves two apiRefs and assembles its title line from both, so a single `PageHeader` would have to
pick one and drop the other. An exclusion list inside the lint is precisely how the hand surveys
drifted.

Pairs with [P10](#p10--a-declared-navigation-must-resolve--or-must-not-be-declared): P10 asks
whether a declared route resolves at all, P25 asks whether what it resolves to names itself.

Resolution is by **(plural, name)**, never by name alone — 28 names in this chart are shared across
kinds, so a name-keyed index resolves to whichever document helm rendered last, which is decided by
template filename order. The first draft of this rule keyed by name and got the right answer by
luck. The plural is already in hand: it is the `resource` on the `resourcesRefs` entry being
followed.

*Evidence: run against the chart before the fix the rule reproduced all four gaps found by hand;
after the templated-items defect was fixed it found two more that had never been migrated —
`page-alert-detail` and `page-agent-detail`, the same two the very first hand survey missed. The
violations fixture now carries a templated page, and reverting the rule to the old behaviour makes
that fixture go silent (1 -> 0), which is the regression test the first draft lacked*

## Behaviour and honesty

### P10 — A declared navigation must resolve — or must not be declared.

**Status:** CR

`buildRowPath` marks a path missing if any placeholder resolves to `undefined` *or empty string*, and `onRow` then returns `{}` — no handler, no cursor, no warning. The row is identical to a working one.

```
if (value === undefined || value === '') { missing = true }
const path = buildRowPath(row)
if (!path) { return {} }   ← silent
```

*Evidence: verified `Table.tsx:35-46`, `:218-222` — found live on builder rows with a hardcoded empty `url`*

### P11 — Never emit an empty string where the widget’s fallback means something else.

**Status:** CR

`Table` renders `-` for any falsy cell, so a deliberately blank cell reads as “no data” rather than “not applicable”. Emit `U+00A0` when blank is the content.

*Evidence: verified `Table.tsx:178`*

### P12 — Nothing looks interactive unless it is.

**Status:** CR

Inert panel-header icons with button fill and hover, and non-functional tags, were both filed. Either give it an action or render it as plain, unboxed decoration.

*Evidence: #69 §0.8 · #69 §0.9*

### P13 — Status vocabulary is Kubernetes-native, and green means healthy.

**Status:** CR

`NotReady`, `NotSynced`, `Unhealthy` — never invented synonyms. A status colour is computed, never a literal: a hardcoded colour beside a branching label is how a failed state renders in the same tint as a queued one.

*Evidence: #56 §0.2 · #78 §0.6 · see C11–C13 for the component-side pipelines*

### P14 — Status indicators are exception-only.

**Status:** CR

Show a marker for the state needing attention. The healthy default renders nothing — a badge on every row hides the one row that matters.

*Evidence: consistent with #72 §0.6 · `FreshnessBadge` verified compliant*

### P15 — No emoji in titles, headings or status text.

**Status:** CR

*Evidence: #69 §0.3 — the same emoji reappeared twice more on that page*

## Words

### P16 — An error says what failed and what to do next. It never apologises or fills space.

**Status:** gap → **fixed**

`useCatchError`'s app-wide default no longer apologises. It read *"Ops! Something didn't work" / "Unable to complete the operation, please try later"* — apologetic, non-actionable, misspelled, and reached from every data-fetching widget plus Auth and Login, so it was the string users hit most. Now: *"The request did not complete" / "Try again. If it keeps happening, check your connection and permissions for this resource."*

The house style is otherwise consistent and good — four widgets pair a title with a specific description, Login says *“Wrong username or password, try again with different credentials”*, the voice path names the provider and the retry window.

One string breaks it, and it is the one users hit most: `useCatchError` is the app-wide default for any unrecognised error — reached from every data-fetching widget, plus Auth and Login — and reads *“Ops! Something didn’t work” / “Unable to complete the operation, please try later.”* Apologetic, non-actionable, and misspelled.

*Evidence: verified `useCatchError.tsx:20-21` vs the pattern in `Button.tsx:27`, `Card.tsx:67`, `Form.tsx:376`, `ListView.tsx:75`*

### P17 — User-facing copy never leaks implementation vocabulary.

**Status:** gap → **fixed**

Two strings stopped using our vocabulary for the reader's situation. *"The widget does not exist"* → *"This part of the page could not be loaded"* — a reader is looking at a page missing a piece, not at a widget. And the Form's `Submit action type is not "rest"` → *"This form is not configured to submit. Ask whoever maintains this page."*, because `type !== 'rest'` is a chart-authoring mistake the person at the form cannot fix; the detail stays in the console for whoever can.

Rendered to end users today: *“The widget does not exist”*, *“does not have a status specification”*, `Submit action type is not "rest"`, and raw `resourceRefId`s inside error descriptions. A reader manages alerts, not Alert CRs.

*Evidence: verified `WidgetRenderer.tsx:161,167,199` · `Form.tsx:386`*

### P18 — A confirm button names the outcome it confirms.

**Status:** gap → **fixed**

The one HITL gate every mutating write passes through now names its verb: *"Confirm delete"*, *"Confirm create"*, *"Confirm 4 writes"*. `VERB_INTENT` — the same map the modal body already renders — is exported from `BlastRadiusConfirm` and imported by `confirmModalProps` rather than restated, so the button and the body cannot drift.

`confirmModalProps.ts` is documented as *“the ONE HITL gate every mutating write passes through”* — and hardcodes `okText: 'Confirm'`, even though `BlastRadiusConfirm`’s `VERB_INTENT` map already knows whether this is a create, update, replace or **delete**, and shows it in the body. The sibling publish gate does it correctly with *“Confirm destination”*.

On a platform whose whole premise is that blast radius is visible before you commit, the button should say the verb.

*Evidence: verified `confirmModalProps.ts:63,66` vs `publishTargetForm.tsx:125-126`*

### P19 — Truncated text always carries its full value on hover.

**Status:** gap → **fixed**

Both violators now carry their full value on hover: `CommandPalette` result titles and the Projects `Select` labels. The Select needed care — `label` is a `ReactNode`, so the title is set only when it is actually a string; `String()`-ing a node yields `[object Object]`, which is worse than no tooltip.

Six compliant instances make this real house convention — Breadcrumb, Notifications, Table, Card, ListView, and the rail’s evidence rows. Two live violators: `CommandPalette` search results and the Projects `Select`, both truncating arbitrary-length names with no `title` or tooltip.

*Evidence: verified `CommandPalette.tsx:137-138` · `Select.tsx:128,144`*

### P20 — Error titles are sentence case.

**Status:** minor → **fixed**

`'Internal Server Error'` → *"The server hit an unexpected error"*: sentence case like its siblings in the same function, and it says what happened rather than echoing an HTTP status name.

`'Internal Server Error'` is the one Title-Case outlier, sitting in the same function as sentence-case siblings.

*Evidence: verified `useCatchError.tsx:33`*

## Forms

### P21 — Required fields render up front; optional fields collapse under “Advanced” but stay mounted.

**Status:** holds

Partitioned on `schema.required`, with `forceRender` so collapsed fields still register, validate and submit. Codified so a future change doesn’t unmount them instead of hiding them.

*Evidence: verified `SchemaFields.tsx:150-186`*

### P22 — A control’s width matches its semantics.

**Status:** holds

Selects, number inputs and JSON editors stretch to the column; a boolean `Switch` keeps its natural size. The one control with no width and no placeholder opinion is the plain string `Input`.

*Evidence: verified `SchemaFields.tsx:48-64`*

### P23 — Form actions: draft left, Cancel and primary grouped right, primary last.

**Status:** holds

Consistent with P6 and C18. A gated primary is rendered visibly disabled rather than merely losing its cursor.

*Evidence: verified `Form.tsx:63-110` · `Form.module.css:24-41`*

### P24 — A label sits above its control at full width.

**Status:** landed

Every schema field gets `labelCol`/`wrapperCol` span 24 unconditionally, with the fix citing its issue by number — this was #54 §0.4’s label-overlap bug.

*Evidence: verified `SchemaFields.tsx:126-137`*
