# Layer 2 — Component contracts

A contract here is fixed once and fixes every page. The repo contains the proof on both sides: the contracts that were built stopped producing findings, and the ones that were only recommended were re-filed per page.

## Built — and the model worked

### C1 — `Breadcrumb` — alignment and truncation live in the shared component.

**Status:** exists

#78 §0.1 states the payoff exactly: *“a genuine shared-code fix — not CR content — and fixing it here fixes every page’s breadcrumb.”* Truncation is biased so the **first** segment keeps priority.

*Evidence: #69 §0.1 · #78 §0.1 — `ui/src/components/Breadcrumb`*

### C2 — `DrawerHeader` — one drawer header for the whole portal.

**Status:** exists

Filed as “four different implementations, three different inconsistencies.” Now a single component.

*Evidence: #86 §0.10 — `ui/src/components/DrawerHeader`*

### C3 — The keyboard focus ring is defined once, globally.

**Status:** exemplar

`ui/index.css:112-115` sets `*:focus-visible` with a comment citing WCAG 2.4.7. The only two `outline: none` in the tree both pair with a `:focus-within` replacement rather than a naked removal.

Worth stating because of what follows: the ring is **not** broken. It applies to nothing in C11–C13 because those elements never receive focus at all. Fix focusability and the ring works for free.

*Evidence: verified `ui/index.css:112-115`*

### C4 — A non-modal docked panel implements its own focus trap and Escape handling.

**Status:** exemplar

`useRailFocusTrap` Tab-cycles within the rail and maps Escape to the same collapse path as the button — necessary precisely because the rail is a plain `<aside>`, not an antd Drawer, so it gets none of this free. Any future bespoke overlay is held to this bar.

*Evidence: #174 — verified `ui/src/components/Autopilot/focusTrap.ts`*

## Recommended

<!-- This section was headed "Recommended, never built". C5 was built and adopted
     while it sat here, which made the heading contradict the first line of its own first rule. -->

### C5 — `PageHeader` — eyebrow, title, counter, tags, actions, subtitle, in one place.

**Status:** missing → **built and ADOPTED**

Shipped in frontend 1.6.0 and adopted across **25 of the portal's 26 page headers** (the exception is `/settings/access/{username}`, left alone deliberately — its two Paragraphs read different RESTActions, so merging would drag the page H1 onto an 11-stage action for identical text). The chart went from 597 CR files to 533.

Two follow-ups were forced by real use rather than foreseen: `allowedResources`/`items` became optional (a header with no CTA should not declare actions it does not have), and `counterLabel` was added (`/marketplace` counts "23 blueprints", where the noun tracks the active facet).

> **Superseded by the status line above.** This blockquote is kept because it records what was true
> when the widget landed, but every claim in it is now spent: the frontend release happened (1.6.0,
> with the CRD), and adoption is done — the chart renders **28 `PageHeader` CRs** and the `page-header`
> lint rule (P25) passes with exactly one annotated opt-out.

Its absence is named as the reason a finding could not be fixed centrally: *“no dedicated page-header component exists to point to.”* Most of the Layer 3 page rules exist because this does not.

**What its absence looks like, measured.** Two pages in the same product, both about operational events, build the same chrome from different primitives under three different names:

```
incident-detail      Flex  …-header-block  →  …-titleline + …-title-stack + meta Card
alert-detail         Flex  …-header-block
composition-detail   Flex  …-header-block  →  …-title-line
cluster-detail       Flex                      …-title-line
observability        Row   …-header-row    →  obs-header + obs-header-actions, 16/8 spans
```

Three spellings of one concept, and one page reaching for a `Row` where the rest use a `Flex`. Nobody decided the headers should differ — there was nothing to reuse, so each page built one.

This is worth separating from a legitimate difference. Those two pages’ *bodies* are architecturally opposite — incident detail stacks eight cards, observability is three items wrapped around a single Tabs — and by P8 both are correct, because one is a single object’s narrative and the other is three datasets. **The body may differ; the chrome may not.** A `PageHeader` constrains neither.

*Evidence: #72 §0.1 · 28 `PageHeader` CRs in the rendered chart, and P25 green with one documented opt-out*

### C6 — `TitleLine` — title and status tag on one baseline-centred row.

**Status:** missing → **partly covered**

> `PageHeader` (C5) now carries the title/counter/tags row for PAGE headers, which is where four of the five original findings were. A standalone `TitleLine` is still missing for the same pattern inside a panel or card — lower urgency, same defect class.

Re-filed on four pages across five findings. #86 §0.6 notes a shipped fix *targeted the wrong layer* — because with no component, there is no right layer to target.

*Evidence: #78 §0.3 · #81 §0.2 · #83 §0.4 · #86 §0.3 · #86 §0.6 — verified absent*

### C7 — `HeaderIconButton` — one fixed box for every header chrome control.

**Status:** missing → **built and in use**

`components/HeaderIconButton` ships one fixed box for header chrome controls, with `ariaLabel` a REQUIRED prop rather than an optional courtesy. In use in 2 files.

Today: a custom button, an antd circle button, and an antd circle button wrapped in a badge span — three implementations, three alignments.

*Evidence: #80 §0.7 — verified absent*

## Keyboard and semantics

### C8 — A clickable row is keyboard-operable: focusable, announced, and activated by Enter and Space.

**Status:** gap → **fixed** — **residual:** not on the card-tile row

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/widgets/List/ListView.tsx:244` — the card tile spreads the row's `onKeyDown` onto the `<Card>` that contains the focusable, so the handler is on the wrong node. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

> **Fixed** (#200). One shared `rowNavProps` helper across the default row, tree row, card tile and rich row, plus the notification rows. A correction from doing it: the audit reported FIVE navigable shapes — the fifth is already an antd `Button` and carries this natively. Four were real.

`Table` fixed exactly this and left the standard in a comment; `Table.a11y.test.tsx` quotes WCAG 2.1.1. `ListView` reproduces the original bug across **five navigable shapes** — including the Marketplace card grid — plus the notification drawer rows: `onClick` and `cursor: pointer` with no `tabIndex`, `role` or `onKeyDown`.

*Evidence: verified `ListView.tsx:119,152,171,212,329` · `Notifications.tsx:97` vs `Table.tsx:226-244`*

### C9 — Every icon-only trigger carries an accessible name.

**Status:** gap → **fixed**

> **Resolved since this rule was written.** `aria-label` added to the notification bell. Landed in PR #195.

The header notification bell — present on every page — has no `aria-label`, no tooltip and no text. The rail’s nine icon buttons are all labelled, so the standard exists; the header predates it.

*Evidence: verified `Notifications.tsx:159-163` vs `ThemeToggle.tsx:15`*

### C10 — A click-triggered menu’s trigger is itself focusable — a Popover does not add that for you.

**Status:** gap → **fixed**

> **Resolved since this rule was written.** The trigger is now a real `<button>` with the chrome stripped, and the Popover is controlled so `aria-expanded` reports its state. Landed in PR #195. **C8 (List/Notifications rows) is still open** — same class, different surface.

**The user menu cannot be opened without a mouse, on every page.** `<Popover trigger='click'>` wraps a bare `<Avatar>`, which renders a `<span>` with no role and no tabIndex; antd binds only `onClick`. The one `<Dropdown>` in the codebase does it correctly, triggering off a real `<Button aria-label='Row actions'>`.

*Evidence: verified `UserMenu.tsx:85-92`*

## Colour pipelines

### C11 — Two colour vocabularies share value names, and neither schema said which it took.

**Status:** gap → **corrected: not a defect** — **residual:** the schema text still does not say it

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/widgets/Tag/Tag.schema.json:40` — `"the tag color (preset name or hex)"`, shipped identically to `helm/frontend-crds/templates/Tag.crd.yaml:157`. The vocabularies were reconciled; the schema still does not disambiguate them. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

> **Corrected.** This rule said `Button.color` wrongly bypasses `getColorCode` while `iconColor` beside it routes through. **They are two different vocabularies by design.** `Button.color` mirrors antd’s own 16-value preset list verbatim, per the authoring convention that `widgetData` copies antd’s enums exactly — and three of its values (`default`, `primary`, `danger`) are not colours at all. Routing it through the palette would break antd fidelity and mangle those three.
>
> The real defect is the **collision**: `green`, `blue`, `red` and `orange` exist in *both* vocabularies with different results. Fixed in the schemas and CRDs (#201) so a CR author learns it by reading, rather than by comparing two rendered pages.

`Button.tsx:57` passes `color` directly to antd’s native preset ramp, while `iconColor` four lines below routes through `getColorCode`. So `color: 'green'` renders antd’s stock green on a Button and Krateo’s brand green on a Table column — same string, two pipelines, two hexes.

*Evidence: verified `Button.tsx:57` vs `:61` and `Table.tsx:121`*

### C12 — A status treatment covers the whole status palette, not the two values someone needed first.

**Status:** gap → **fixed**, for the treatment; the enum union still holds

> **Corrected.** This rule sat marked `gap` while the fix lived in the file it cites, starting two
> lines after the cited range ended. Reading `Card.module.css:250-290` and stopping there is exactly
> what the citation invited.

`Card.module.css` re-tinted the badge variant for `warning` and `error` only, so `extraStatus: 'success'` fell through to a hardcoded **cyan** and never rendered green — #78 §0.6's root cause. It now carries `&:has(.ant-badge-status-success)`, tinting background, border, dot and text from `var(--green-color)`, and `&:has(.ant-badge-status-default)` for neutral grey. `processing` deliberately keeps cyan, which is the antd meaning of that value rather than an oversight.

**The second half of this rule still holds.** The same field's enum unions two incompatible vocabularies — antd-native `success|processing|warning|error|default` with brand names `green|gold|red|blue|violet` — and nothing prevents pairing the wrong one with the wrong variant.

*Evidence: verified `Card.module.css` `&:has(:global(.ant-badge-status-success))` and the `-default` block below it · `Card.type.d.ts` `extraStatus`*

### C13 — A `Tag` never renders a colour swatch with no label.

**Status:** gap → **fixed, and lint-enforced** — **residual:** an empty-string value still renders a bare swatch

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/widgets/Table/Table.tsx:121` — `{stringValue ?? '-'}` is nullish-only, so `""` renders a palette-tinted `Tag` with no text, which is precisely what the rule forbids. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

`tag-colour-no-label` in `lint-portal-consistency.py` reports 0 violations against the portal chart and runs on every PR in both repos. The rule also survives in code: `StatusPill` draws its leading dot only when there is a LABEL, so a colour-only pill cannot be produced by the widget either.

`showDot` has no guard on `label`. When a template resolves the label to empty, the widget renders a coloured dot in an otherwise-empty pill — meaning carried by colour alone, with nothing for a screen reader or a colourblind reader. Root cause of #82 §0.7.

*Evidence: verified `Tag.tsx:22-24`*

## States and shared treatments

### C14 — Empty states route through the shared `WidgetEmpty`.

**Status:** gap → **fixed**

> **Fixed** (#203). `Tabs`, `BarChart`, `PieChart`, `LineChart` and `FlowChart` now route through `WidgetEmpty`, each with copy naming what is missing rather than showing a bare icon.

Five of six collection widgets — `Tabs`, `BarChart`, `PieChart`, `LineChart`, `FlowChart` — hand-roll their own `<Empty>`, so none gets the shared wrapper or a widget-specific description, and a future change to the empty treatment reaches none of them.

*Evidence: verified `Tabs.tsx:59`, `BarChart.tsx:30`, `PieChart.tsx:39`, `LineChart.tsx:110`, `FlowChart.tsx:28`*

### C15 — `Table` has an empty-state contract at all.

**Status:** gap → **fixed**

> **Fixed** (#203) via `locale.emptyText`. `hideWhenEmpty` — which `List` has and `Table` does not — is deliberately still absent: it is a new schema field, so it needs the CRD and chart to move with it. This was the rendering contract only.

`hideWhenEmpty` is `List`-only. `Table` passes a possibly-empty `dataSource` straight to antd with no length check and no `WidgetEmpty` — so a table backed by a zero-row action cannot be configured to suppress itself, and its empty rendering is antd’s unstyled default. Extends #72 §0.6.

*Evidence: verified `Table.tsx:224` vs `ListView.tsx:88-91`*

### C16 — Widget failure is isolated per instance.

**Status:** holds

Every widget with a `resourceRefId` mounts its own renderer and query, so a page with three failing actions among ten widgets shows three inline error cards in place and renders the other seven. Codified so a regression — a shared try/catch or a page-level loading gate — is recognisable as one.

*Evidence: verified: recursive nested `WidgetRenderer` pattern, one root per page*

### C17 — The micro-label idiom is one shared style.

**Status:** gap → **fixed**

The micro-label tier now exists as tokens — `text-label-sm` (11px) and `text-label-xs` (10px), the two steps below the scale's 12px floor that 52 hardcoded sizes were reaching for. In use across 14 CSS files.

Twelve files combine uppercase with the mono face for column headers, card eyebrows and status captions. Each picks its own size — 9 to 12.5px — while **six or more independently converged on `letter-spacing: 0.08em`**. Convergence that strong is a token waiting to be named.

*Evidence: verified across `Table`, `Card`, `Descriptions`, `Select`, `Statistic`, `Steps`, `Breadcrumb`, `Paragraph`*

### C18 — Button size is `middle` by default; `small` is never hardcoded where a CR cannot reach it.

**Status:** open → **holds, with a documented exception list**

Filed as "the largest class in the backlog — 12 findings, 10 issues". Re-measured against the
code, the rule is satisfied where it matters and the remaining instances are correct.

**The CR-reachable case is already right.** `Button.schema.json` exposes `size`
(`small|middle|large`) and `Button.tsx:66` renders `size={size || 'middle'}` — middle by default,
overridable per CR. That is precisely what #81 §0.1 asked for, and it landed.

**The nine hardcoded `size='small'` sites are not CR-authored Buttons.** Four are not Buttons at
all — a `Descriptions` (Form review table), two `Progress` bars (Table cell, ListView bar), and a
tile `Card`. The other five are a widget's OWN chrome, where `small` is the correct antd size:

| site | what it is |
|---|---|
| `Markdown.tsx:75` | the copy icon inside a code fence |
| `ListView.tsx:185` | a filter chip (`className={styles.chip}`) |
| `ListView.tsx:310` | the row-actions `⋮` menu (`type='text'`) |
| `Select.tsx:159,162` | Clear / Apply in the select popup footer |

Applied literally to those, the rule would render a code-block copy icon at the same size as a page
CTA. **The rule was reaching for "a widget must not silently impose density on page CONTENT", and
none of these is content.**

Residue, if anyone wants it: `ListView` chips are compact by convention and a CR cannot change
that. Making them author-controlled is a density judgement, not a parity defect.

The largest class in the backlog — 12 findings, 10 issues.

> **Corrected.** An earlier version of this rule said `ListView.tsx` "still hardcodes `size='small'`
> at four call sites", and its evidence line cited four line numbers that today hold `{child}`, a
> blank line, a `</div>` and a `},`. Both survived the correction that produced the current status
> and contradicted it. The real sites are the two named in the table above — the filter chip and the
> row-actions menu — and both are the documented exception, not the defect.

*Evidence: verified `ListView.tsx` filter chip and row-actions menu, as cited in the table above ·
`Button.tsx` renders `size={size || 'middle'}`*

### C19 — `FlowChart` — edges curve, and nodes get room not to collide.

**Status:** landed

The library defaults edges to `router:{type:'orth'}`, squaring every edge into the rank gap; at the old `ranksep: 60` several were drawn as one line inside a 60px corridor. Every edge was correct and the graph was unreadable.

```
// origin/main
edge={{ style: { router: false }, type: 'cubic-horizontal' }}   // router:false is load-bearing:
layout={{ nodesep: 32, rankdir: 'LR', ranksep: 160, type: 'dagre' }}  // options deep-merge, so omitting
size: [400, 150]                                          // the key keeps the inherited orth
```

Generalises past this widget: a node size must fit its container — the old `[300,140]` was sized against a 400px card — and a layout gap must exceed what the edge style needs to route through it.

**Where it lives now (C24).** The edge shape, layout, ports and viewport are defined once, in
`ui/src/components/DependencyGraph/graphConfig.ts`, and drawn by `DependencyGraph`, which both
`FlowChart` and the Blueprint Composer's architecture graph render through. The node `size` stays
beside each card, because it is the card's geometry. A caller that knows each node's level passes a
per-edge `minlen`, because dagre's own ranks are not levels (a root feeding only a level-2 node lands
in column 1).

*Evidence: #192 — verified on `origin/main`*

### C20 — `Table` — `fitContent` is an explicit choice between two opposite behaviours.

**Status:** landed

`true` shrinks columns to the container and ellipsis-truncates; `false` and unset set `scroll.x: 'max-content'` and allow a horizontal scrollbar. Leaving it unset picks the second by accident — which is how a matrix ends up with truncated headers. Per-column `width`/`minWidth` exist for where content-fitting alone gets it wrong.

*Evidence: verified `Table.tsx:75`, `:96` · #192*

### C21 — A container with a header region exposes the shared header-action slot, not a bespoke one.

**Status:** open → **deferred, with a named trigger** — the demand it predicted went somewhere else

The rule expected the "no slot for a real header button" bug to recur on `Table`, `Tabs` or `List`.
Measured, it has not, and the reason is that the demand moved rather than disappeared.

The chart has had exactly ONE container faking a header-action row in its history:
`flex.header-actions-flex` at 1.8.8, pairing the dashboard's range chips with the "New composition"
Button. The `PageHeader` migration dissolved it — the CTA is now a header action, the chips a
sibling filter bar. On `main` there are **zero** containers pairing a collection with buttons.

So page-level actions found their home in `PageHeader` (25 pages), and section-level actions inside
a `Table`/`Tabs`/`List` have not been wanted once. `Card.extraRefId` — the one slot that exists —
is used by a single CR in the whole chart.

Building the same field into three more widgets today would be three schema fields, three CRD
changes and three implementations against a measured demand of zero.

**The trigger, so this is a decision and not an oversight:** the next time a chart has to wrap a
`Table`, `Tabs` or `List` in a Flex just to sit a Button beside its header, that container gets
`extraRefId`, copied from `Card` — same name, same shape, a `resourceRefId` resolved through
`getEndpointUrl` and rendered as a nested widget in the header's trailing edge. The X5 containment
lint makes such a wrapper easy to spot, since the faked header is a container whose declared
children are a collection *and* buttons.

`Card` gained `extraRefId` — a real widget slot rather than a plain string — for #83 §0.8, and it is **the only widget that has one**. `Table`, `Tabs` and `List` have no equivalent, so the “no slot for a real header button” bug recurs the next time someone attaches an action to one of them.

*Evidence: verified: `extraRefId` appears only in Card’s four files · #83 §0.8 · #86 §0.9b*

### C22 — Container chrome spacing is the container’s responsibility, never a child’s defensive margin.

**Status:** exemplar

A shipped lesson: the first fix for #128 added a `margin-top` to `Steps` to clear a `Card`’s floated icon. It was **reverted** in favour of a `.clearsIcon` modifier on `Card`, applied whenever the card has an icon and no left header — because the clearance is a property of any such card, Steps or not.

Review heuristic: a child widget’s CSS naming a specific parent widget to justify a margin is the smell.

*Evidence: #128 — commits `3ec8557` then `286b369`*

### C23 — Drawer surfaces stack, and only one pair has ever agreed on an order.

**Status:** open → **fixed — the stack is declared in one place and guarded by a test** — **residual:** the widget `Modal` surface never joined the stack

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/widgets/Modal/Modal.tsx:69-85`, mounted at `ui/src/components/Shell/Shell.tsx:86` one line below `<Drawer />` — the declared stack covers Drawer, not this. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

`theme/layers.ts` now declares all four surfaces in order, and each imports its value:

```
DRAWER        1000   page content — antd's own base, now stated rather than inherited
PREVIEW       1010   the mask-less side-by-side working surface
NOTIFICATIONS 1050   transient chrome; the bell must always reach the front
CONFIRM       1100   above every surface that can host a gated action
```

Two things were wrong beyond "some surfaces declare nothing". The two values that DID exist lived
in different files, and the upper one was written as a bare `1100` rather than derived — so raising
the preview could have silently overtaken the gate. And the widget drawer and Notifications both
landed on `zIndexPopupBase`, which means their order was decided by DOM order, which is to say by
nobody.

**One behaviour change, deliberate:** Notifications now sits above the widget drawer and the
preview. Clicking the bell must produce a drawer you can see, whatever else is open.

A unit test asserts the confirm outranks everything and that no two surfaces share a value. The
trapped-gate bug — a publish confirm opening behind the preview and becoming untouchable — is the
reason this is a test rather than a comment.

There are **three independent drawer surfaces**, each owning its own open state, with nothing coordinating them: the widget `Drawer` mounted once in the shell, the `Notifications` drawer, and the Autopilot `previewSurface`. Any of them can be open while another is.

Within the widget drawer there is exactly one instance — a module-level `{isOpen, properties}` object that `openDrawer` overwrites. That is deliberate: the drawer sits in a subtree React remounts whenever the router version bumps or the layout refreshes, so React state would close an open drawer under the user every 30–90 seconds.

**The replacement consequence:** calling `openDrawer` while a widget drawer is open swaps its contents silently, and `destroyOnHidden` tears the old content down. A partly-filled form is gone — no prompt, no undo. So never place an `openDrawer` action inside a drawer, and if the dead `openDrawer` Autopilot verb (A6) is implemented it must refuse rather than replace.

**Cross-surface stacking is real, and in one case intended.** During a portal-builder preview the preview drawer deliberately drops its dimming mask and shifts left by the rail's width so the preview and the conversation stay visible and interactive together. That is a designed side-by-side, not an accident.

It has also already gone wrong once. The preview drawer is pinned at z-index 1000 and the blast-radius confirm raised to 1100 *because a publish gate was opening behind the preview* and became untouchable. That fix is the only declared ordering in the system.

Everything else is undefined. Notifications declares no z-index; the widget drawer declares none. Open the preview, then the bell, and which wins is antd's default — nobody decided it.

**The rule:** a new drawer surface declares its z-index relative to the existing ones rather than inheriting a default, and any surface that can host a gated action sits *below* the confirm — the trapped-gate bug is the one that makes a page unusable rather than merely untidy.

*Evidence: verified `Drawer.tsx:14-49` · `Notifications.tsx:230` · `previewSurface.tsx:47-55,376-396` · Shell mounts one `<Drawer />`*

### C24 — A widget that draws something the set already draws must reuse the component, not re-derive it.

Not "must look the same" — must **be** the same component. A second implementation that agrees
today is not a match, it is a copy waiting to drift, and the drift is invisible: same colour, same
word, one detail missing.

This rule exists because it was broken the day `PageHeader` was written. Its native `tags` array
rendered a bare antd `Tag` with the shared palette tint applied — correct hex, correct label, and
**no leading status dot**, which the `Tag` widget draws for every coloured, labelled pill. On a
detail page the two pills sit inches apart and did not match.

Every check that existed passed. The colour came from the shared palette, so the token rules were
satisfied. The CRD validated, because a missing 6px circle is not a schema error. The widget's own
test asserted the tag's **label** — which says nothing about the pill. It was found by an
adversarial review of a *later* migration, one page before four detail pages inherited it.

The tell is textual and easy to grep for: a widget importing a primitive (`import { Tag } from
'antd'`) plus the shared styling helper that the set's own widget already applies (`getTagStyle`).
That pairing means a component was rebuilt rather than reused. Extract the shared piece — the way
`StatusPill` now backs both `Tag` and `PageHeader` — and forward unrecognised props untouched, so
the extraction is not a silent behaviour change.

Applies to the CR surface too, not just rendering: before giving a new widget a required field,
read what the closest existing widget requires. `PageHeader` shipped with `allowedResources` and
`items` required because they were copied from a container schema; `Card`, the actual precedent,
requires only `items`. That cost a release cycle to undo, on a widget whose entire purpose was to
delete ceremony.


### C25 — A widget wrapping antd uses antd's prop names verbatim. A widget wrapping nothing documents itself.

**Status:** gap → **fixed**

> **Fixed.** Both halves. The rule is written down below, and schema coverage went from
> **799/2,317 (34%) to 2,317/2,317 (100%)** — measured by the same walk, before and after.
>
> The second half was carrying a **measurement error, and the exhibits below were its symptom**.
> 34% was arithmetically right and substantively wrong: **1,279 of the 1,518 undescribed properties
> (84%) sat outside `spec.widgetData` entirely.** They are the shared CR envelope — `apiRef`,
> `resourcesRefs`, `resourcesRefsTemplate`, `widgetDataTemplate`, `version`, `kind` — roughly the
> same 29 paths emitted into all 44 schemas and counted 44 times. On the vocabulary a CR author
> actually writes, coverage was **738/811 = 91%**, not 34%.
>
> So the exhibits were false in the way that matters. Their real `widgetData` coverage was
> **YamlViewer 1/1, Filters 3/3, Markdown 4/4, RangePicker 5/5, Tag 9/9 — all 100%** — and
> ButtonGroup 6/7. A `Filters` author writes `prefix` and `items[].resourceRefId`; all three were
> described. The other 29 were envelope every widget shares. The struck table is kept below rather
> than deleted, because a rule that was wrong once should show its own correction.
>
> **The genuine gap was 73 properties**, and it is now closed: List 36 (the `grid/*` block and
> `itemTemplate/*`), Theme 6, `items[].resourceRefId` in four container widgets, and 9 action
> properties — `loading`, `loading/display`, `onEventNavigateTo/reloadRoutes` — fixed once at their
> source in `ui/src/schemas/actions.schema.json` and re-synced into Button, Card, Form and List.
>
> **The envelope is described once, not 44 times.** `buildSchema` in `ui/scripts/widget-codegen.ts`
> now emits descriptions for the shared block, so newly scaffolded widgets inherit them; a one-off
> migration filled the 44 existing schemas. Note that `gen-antd-widgets` *skips widgets that already
> exist*, so the generator change alone would have reached none of them — that is why both were
> needed. Property sets were verified byte-identical before and after; only `description` fields were
> added, and `validate-schemas` passes.
>
> **List's `grid/*` mirror antd** (`grid.gutter`, `grid.column`, `grid.xs`…) even though `List.tsx`
> imports no antd List, so they point at antd's docs rather than inventing prose — the two halves
> meeting, which the rule had not addressed.

The original status read: *gap — the convention exists and is obeyed; the rule was never written, so its scope was undefined*.

Two halves, and the second is the one nobody has been keeping.

**Where a widget wraps an antd component, `widgetData` uses antd's prop names verbatim** — `Alert`
takes `banner, closable, description, showIcon, title, type`; `Table` takes `bordered, columns,
dataSource, pagination, size`. The payoff is documentation: **antd's own docs become the widget's
docs**, and Krateo does not have to describe 2,317 properties it did not design.

**Where there is no antd counterpart, the schema must carry its own descriptions** — because nothing
else will. The convention says "read antd's docs", and for these there are none.

**Measured when this rule was written:** 44 schemas, 2,317 properties, **799 described (34%)**.
30 widgets are antd-backed (the widget imports its own namesake); **14 wrap nothing**. The gap was
reported as landing exactly where predicted:

    ~~YamlViewer    2/36   5%      Markdown     5/39  12%      ButtonGroup  9/42  21%~~
    ~~Filters       3/32   9%      RangePicker  6/40  15%      Tag         10/44  22%~~

**That table counted the wrong denominator and is retained only as the record of the error.** Each
figure counts the shared CR envelope — the ~29 generated paths every widget carries — against a
widget that never authored them. Measured on `spec.widgetData`, the vocabulary a CR author writes,
every one of those widgets was at or near 100% before any of this work: YamlViewer 1/1, Filters 3/3,
Markdown 4/4, RangePicker 5/5, Tag 9/9, ButtonGroup 6/7.

The sentence that followed — *"a CR author writing a `Filters` widget has 3 described properties out
of 32"* — was false. A `Filters` author writes three properties and all three were described.

**The mirror is already not a mirror, and the rule should say so.** Every widget adds Krateo props
antd has no concept of — `allowedResources`, `resourceRefId`, `widgetDataTemplate`, `fitContent`,
`rowNavigateTo`, `watch`. So an author cannot rely on antd alone in any case; they need to know which
props are antd's, which are Krateo's, and which antd props are unsupported. The schema is the real
contract. antd's docs are a shortcut for the part of it antd already wrote.

**The cost this rule accepts, stated rather than discovered.** Mirroring couples the CR vocabulary to
antd's API, and a CR is *stored data*. antd 6 renamed `Progress`'s DOM nodes, `Select`'s content node
and the notification title node, and each break landed here. When antd renames a **prop**, either
stored CRs break or a translation layer makes the mirror a fiction. That is the price of the
documentation leverage, and it is worth paying only where the leverage is real — which is the reason
the rule stops at antd-backed widgets instead of being a house style.

**Testable, and it should be tested.** A widget with no antd import of its own namesake and a
description ratio below a floor is decidable from the schemas alone. It would flag the six above
today, and stop the seventh being added.

> **Why this was written down late.** The phrase "the antd-mirror rule" appears in two source
> comments (`VoiceControl.tsx`, `SpeakBackControls.tsx`) as though it were established, and in this
> document only once — in a subordinate clause inside a correction to a different rule. A convention
> every widget obeys had no statement anywhere, so its SCOPE was undefined, and scope is exactly what
> people then argued about: whether it reaches app chrome, shared primitives, or the Autopilot rail.
> It reaches none of them. It binds a widget to the antd component that widget wraps, and nothing else.

*Evidence: measured across 44 `ui/src/widgets/*/*.schema.json` (2,317 properties, 799 described) and
the 44 widget `.tsx` files (30 import their own antd namesake, 14 do not)*
