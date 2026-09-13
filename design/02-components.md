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

## Recommended, never built

### C5 — `PageHeader` — eyebrow, title, counter, tags, actions, subtitle, in one place.

**Status:** missing → **built and ADOPTED**

Shipped in frontend 1.6.0 and adopted across **25 of the portal's 26 page headers** (the exception is `/settings/access/{username}`, left alone deliberately — its two Paragraphs read different RESTActions, so merging would drag the page H1 onto an 11-stage action for identical text). The chart went from 597 CR files to 533.

Two follow-ups were forced by real use rather than foreseen: `allowedResources`/`items` became optional (a header with no CTA should not declare actions it does not have), and `counterLabel` was added (`/marketplace` counts "23 blueprints", where the noun tracks the active facet).

> **Built** (#198). The widget ships with `pageheaders` in the Flex/Row/Col enums and its CRD generated. **Adoption is the remaining work**: 46 hand-rolled header CRs across ~12 chart pages collapse to about 14. That is gated on a frontend release — a chart CR referencing `kind: PageHeader` needs the CRD on the cluster first.

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

*Evidence: #72 §0.1 — verified absent · header CRs counted on the chart at origin/main*

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

**Status:** gap → **fixed**

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

**Status:** gap → **corrected: not a defect**

> **Corrected.** This rule said `Button.color` wrongly bypasses `getColorCode` while `iconColor` beside it routes through. **They are two different vocabularies by design.** `Button.color` mirrors antd’s own 16-value preset list verbatim, per the authoring convention that `widgetData` copies antd’s enums exactly — and three of its values (`default`, `primary`, `danger`) are not colours at all. Routing it through the palette would break antd fidelity and mangle those three.
>
> The real defect is the **collision**: `green`, `blue`, `red` and `orange` exist in *both* vocabularies with different results. Fixed in the schemas and CRDs (#201) so a CR author learns it by reading, rather than by comparing two rendered pages.

`Button.tsx:57` passes `color` directly to antd’s native preset ramp, while `iconColor` four lines below routes through `getColorCode`. So `color: 'green'` renders antd’s stock green on a Button and Krateo’s brand green on a Table column — same string, two pipelines, two hexes.

*Evidence: verified `Button.tsx:57` vs `:61` and `Table.tsx:121`*

### C12 — A status treatment covers the whole status palette, not the two values someone needed first.

**Status:** gap

`Card.module.css` re-tints the badge variant for `warning` and `error` only. `success`, `processing` and `default` fall through to a hardcoded **cyan** — so `extraStatus: 'success'` never renders green, breaking “green means healthy” in this one pipeline. This is #78 §0.6’s root cause, still unfixed.

The same field’s enum also unions two incompatible vocabularies — antd-native `success|processing|warning|error|default` with brand names `green|gold|red|blue|violet` — and nothing prevents pairing the wrong one with the wrong variant.

*Evidence: verified `Card.module.css:250-290` · `Card.type.d.ts:256`*

### C13 — A `Tag` never renders a colour swatch with no label.

**Status:** gap → **fixed, and lint-enforced**

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

**Status:** open

The largest class in the backlog — 12 findings, 10 issues. `ListView.tsx` still hardcodes `size='small'` at four call sites; #81 §0.1 asked for `middle` or a schema field and neither landed.

*Evidence: verified `ListView.tsx:153,213,278,302`*

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

*Evidence: #192 — verified on `origin/main`*

### C20 — `Table` — `fitContent` is an explicit choice between two opposite behaviours.

**Status:** landed

`true` shrinks columns to the container and ellipsis-truncates; `false` and unset set `scroll.x: 'max-content'` and allow a horizontal scrollbar. Leaving it unset picks the second by accident — which is how a matrix ends up with truncated headers. Per-column `width`/`minWidth` exist for where content-fitting alone gets it wrong.

*Evidence: verified `Table.tsx:75`, `:96` · #192*

### C21 — A container with a header region exposes the shared header-action slot, not a bespoke one.

**Status:** open

`Card` gained `extraRefId` — a real widget slot rather than a plain string — for #83 §0.8, and it is **the only widget that has one**. `Table`, `Tabs` and `List` have no equivalent, so the “no slot for a real header button” bug recurs the next time someone attaches an action to one of them.

*Evidence: verified: `extraRefId` appears only in Card’s four files · #83 §0.8 · #86 §0.9b*

### C22 — Container chrome spacing is the container’s responsibility, never a child’s defensive margin.

**Status:** exemplar

A shipped lesson: the first fix for #128 added a `margin-top` to `Steps` to clear a `Card`’s floated icon. It was **reverted** in favour of a `.clearsIcon` modifier on `Card`, applied whenever the card has an icon and no left header — because the clearance is a property of any such card, Steps or not.

Review heuristic: a child widget’s CSS naming a specific parent widget to justify a margin is the smell.

*Evidence: #128 — commits `3ec8557` then `286b369`*

### C23 — Drawer surfaces stack, and only one pair has ever agreed on an order.

**Status:** open

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
