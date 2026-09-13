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

**Status:** open

#54 §0.6 asked for a standard gap between major sections and a smaller one within a section. No shared page-rhythm convention exists, and with no `PageHeader` (C5) each page’s section gap stays ad hoc.

*Evidence: #54 §0.6 — confirmed still unresolved*

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

Each method also produced a *confident count*, which is what made the error durable: "25 of 26
migrated" was reported three times, from three parsers that shared a blind spot.

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

*Evidence: the rule, run against the chart before the fix, independently reproduced all four gaps
found by hand — `page-blueprint-install`, `page-clusters-register`, `page-marketplace-detail`,
`page-access-detail` — and reduces to the one annotated exception after*

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
