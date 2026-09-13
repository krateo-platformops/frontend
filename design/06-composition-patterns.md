# Composition patterns

Every rule before this one is prohibitive — don’t add a back link, don’t duplicate the title, don’t hardcode a size. That is a direct consequence of how they were derived: 81 findings from a reviewer hunting defects yields “don’t do X” and never “here is what good looks like.” Nobody files an issue saying a page is well composed.

This section is the other half. Some of it is derived from **what the 29 shipped page compositions actually do**; the rest is a design position. Rules marked judgement are calls, not findings — marked so a reader knows which ones they may overrule with their own taste and which have a defect behind them. They are not offered tentatively. A design system that only forbids produces pages that are never wrong and never good.

## The four archetypes

| Archetype | Shape | Pages |
|---|---|---|
| List | header → filter/action band → collection | 9+ |
| Detail — card stack | header → N cards, stacked | 5 |
| Detail — row-composed | header → Row/Col grid | 3 |
| Create | a bare form, a header + card, or a wizard | 6 |
| Tabbed console | header → scope control → Tabs | 2 |

Median page is 3 items; the largest is 13. The archetypes are real and consistent — they are simply nowhere written down, which is why each new page re-derives one.

### G1 — A list page is header → band → collection, and the band has one name.

**Status:** CR

The shape is already universal. The naming is not — the same middle slot is called four different things:

```
compositions   …-header → …-toolbar      → …-table
blueprints     …-header → …-filterbar    → …-grid
alerts         …-header → …-new-cta      → obs-alerts → …-hint
incidents      …-header → …-status-chips → …-table    → …-awaiting
```

Same divergence as the page headers under C5, one slot down. Pick `toolbar` and use it.

Note the two trailing items: `alerts-hint` renders on every visit (its `hideWhenEmpty` never fires because the action emits an unconditional one-item list), so it is permanent chrome below the table rather than the empty-state hint its name implies.

*Evidence: measured across the 29 page compositions at origin/main*

### G2 — Detail pages stack. Tab the reference material; never tab the narrative.

**Status:** judgement → **decided**

> **Decided.** Stack, and fold only the *reference* material into panel tabs — evidence tables, related items, audit trails. The narrative sections stay stacked.
>
> The reason is not layout, it is grounding: **content on an unvisited tab is not in Autopilot’s context envelope** (A10). Tabbing half of incident-detail means the agent sees half an incident, which degrades the very RCA flow the page exists to support. So the cap is a guide and the narrative/reference split is the actual rule.

Five pages stack, three compose a Row grid, and nothing separates the groups by subject. They diverged. Here is the call: **stack.**

Three reasons. A stack scales in one dimension, so adding a section never re-negotiates a grid’s spans — which is the whole of the `Row.alignment` trap, where a panel with variable-height content stretches its neighbours. A stack keeps the whole object in one context envelope, so Autopilot can reason about the incident rather than the visible third of it (A10). And a stack has one reading order, which is what a detail page *is*: a narrative about one thing.

The row grid’s advantage is density above the fold, and it is real — but it is bought by putting two unrelated panels at the same visual weight, which is P7’s failure mode dressed as layout.

**The cap matters more than the choice.** Past about six cards a stack stops being a narrative and becomes a scroll — `agent-detail` is at 13 and `incident-detail` at 11, and both are past it. The tail folds into panel-level tabs, which `incident-detail` already does correctly for its reasoning trace and evidence. Lead with the sections every visit reads; tab the ones a specific question reaches for.

*Evidence: measured: 5 card-stack vs 3 row-composed · the resolution is a call*

### G3 — A Table is a navigation surface.

**Status:** CR

**16 of 39 Tables carry `rowNavigateTo`.**

> **Corrected, and the rule's premise with it.** This said "31 of 32 — that is not a coincidence, it
> is what the widget is for in this portal". The real figure is 41%, not 97%. The original is
> reproducible by the method that produced it: `ls templates | grep -c '^table\.'` counts 31 files,
> and `grep -rl rowNavigateTo | wc -l` counts files, not CRs — so it compared a file count against a
> file count and missed both the Tables that share a file with something else and the ones that
> carry no navigation. Counting CRs in the rendered chart gives 39 and 16.

So navigation is the *majority* use but not the defining one, and the rule has to be read the other
way round: a table without a destination is common and often correct — a read-only matrix, an env
list, an audit log. Ask what the rows ARE before asking where they go. Where a row does navigate,
P10 still applies: a placeholder that can resolve empty makes the row silently inert.

*Evidence: measured on the rendered chart — 16 of 39 Table CRs*

### G4 — Table for columns, Listy for tiles — and Listy is only half navigational.

**Status:** CR

Both collection widgets are heavily used — 39 Listy, 32 Table — and they are not interchangeable. Table is columnar and near-always navigable. Listy carries card grids and display lists, and only **20 of 39** navigate anywhere; the rest exist to show a set.

Reach for Table when the reader compares rows on shared attributes. Reach for Listy when each item is a thing in its own right — a blueprint tile, a linked composition — and comparison across a column is not the point.

*Evidence: measured: Listy 39 (20 navigational), Table 32*

### G5 — Card is the frame; Descriptions is the key/value body; Statistic is a number inside a card.

**Status:** CR

Measured usage settles the vocabulary: **Card 88** — the default frame, and by far the most-used widget in the portal. **Descriptions 12** — every instance is key/value metadata on a detail page. **Statistic 19** — always the number inside a stat card, never standalone. **Tag 16** — status only. **Steps 3** — real sequences (a wizard, a remediation plan, a reasoning trace).

P7 still governs: Card being the default frame is not licence to card everything. A card that holds one fact should be a row in the Descriptions next to it.

*Evidence: measured across 612 CRs*

### G6 — A stat band belongs where the count *is* the question — not on every list.

**Status:** judgement

Only 2 of 29 pages open with one. That is probably too few rather than correct: on a list where the reader’s first question is “how many, and how many are wrong?”, a three-card band answers it without scanning a status column — which is the exact failure P14 describes at row scale.

But it is not free. A band on a page whose answer is a specific row costs vertical space above the thing the reader came for. The test: **if the count changes what the reader does next, band it; if they came for a row, don’t.**

*Evidence: measured 2/29; the recommendation is judgement*

### G7 — One page, one primary object, one reading order.

**Status:** judgement

The archetypes agree on this without saying it: a list page is about a set, a detail page about one object, a create page about one intent. The pages that read worst are the ones that mix — a detail page that also hosts an unrelated index, a list page carrying permanent instructional chrome (G1’s `alerts-hint`).

Practical form: after the header, everything on the page should be answering the same question. A block that answers a different one is usually another page, or a tab (P8).

*Evidence: judgement, consistent with P3 and P7*

### G8 — Before inventing a visual, check what already ships.

**Status:** judgement

**19 of 43 widget kinds have zero instances in the chart.** Some of that is expected — form controls like Switch and Radio appear inside schema-driven forms rather than as standalone CRs, and Drawer is reached through an `openDrawer` action. But some is real unused capability: `BarChart`, `PieChart` and `Progress` are built, themed and wired to the chart palette, and instantiated nowhere.

`ButtonGroup` is the sharpest case — [#57](https://github.com/krateo-platformops/frontend/issues/57) explicitly recommends it over a bare Row for packing action buttons, and it has never been used once.

This is the same “declared then not adopted” pattern as the dead type scale, one layer up: capability nobody knows is there. Worth a look before anyone builds a custom visual or a hand-rolled button cluster.

*Evidence: measured: 19/43 kinds with zero CR instances*

## The design position

Five calls about what a good page in this product feels like. They are opinions with reasons, and the reasons are what to argue with.

### G9 — The first screenful answers “what is this, and is it healthy?” — before any scrolling.

**Status:** judgement

The single most useful constraint available, and the one most pages fail. A detail page’s opening screen carries the object’s identity, its current state, and the action most visits want. A list page’s opening screen carries the collection — not three rows of chrome and then the collection.

This is what the eyebrow, the back link, the duplicated subtitle and the oversized meta block were each individually stealing. Ten findings across seven issues were variations of one thing: **chrome had colonised the first screenful.** P2, P3 and P4 each remove one offender; this rule says what they were protecting.

*Evidence: the positive form of #69 §0.1–0.6, #72 §0.1, #80 §0.3, #82 §0.2–0.4, #83 §0.3–0.5*

### G10 — Density belongs to the data. Chrome stays thin.

**Status:** judgement

This is a platform console, not a marketing page. Rows should be tight, tables should show many, and a screen should carry real information — the portal was right to raise `cellPaddingBlock` and right that it is a shared token.

But density is a budget, and the backlog shows it spent in the wrong place: padded headers, boxed labels, panels holding one fact. **Spend vertical space on rows; spend almost none on the frame around them.** When a page feels cramped, the fix is nearly always removing chrome, not loosening data.

*Evidence: judgement · consistent with T2, P7 and the density findings in #54, #72, #76*

### G11 — Not everything is a card.

**Status:** judgement

88 Cards across 29 pages. A card’s border, fill and shadow each say *this is a separate object* — so spending them on every block says nothing at all, and flattens the hierarchy the card was meant to create.

Reserve the frame for things that genuinely stand apart. A block holding one fact is a row in the Descriptions beside it. A block that only groups two paragraphs needs whitespace, not a border. Lift the one thing that deserves lifting, and let the rest sit on the page.

*Evidence: measured 88 Card CRs · the recommendation is a call*

### G12 — Colour means status or interaction. It is never decoration, and never the only signal.

**Status:** judgement

Two jobs, and they must not blur: semantic colour reports state, brand colour marks what you can act on. The palette currently blurs them — `info` and `primary` are the same value in both modes, so an informational tag is pixel-identical to a clickable primary (T8). Separate them.

And colour never carries meaning alone: a coloured dot with no label (C13) is invisible to a screen reader and to a colourblind reader, and a status that reads only as a tint fails the moment the page is printed, screenshotted into a ticket, or viewed in the other theme. **Every state that matters has a word.**

*Evidence: judgement · grounded in T8, C11–C13, P13*

### G13 — Stillness is the default. Motion marks change, briefly, and never loops.

**Status:** judgement

Almost nothing in this portal moves, and that is correct for a console someone watches during an incident. Motion earns its place only by reporting that something *changed* — a value updating, a write landing, a state transitioning — and then stopping.

An animation that loops forever is reporting nothing; it is just movement in the corner of the eye of someone trying to read.

> **Corrected — both halves.** This said the freshness pulse "is the one infinite loop in the
> codebase and the one unguarded by `prefers-reduced-motion` (T9)". There are six `infinite`
> declarations across two files (the freshness badge and the Autopilot rail), and the freshness
> badge now carries its own `@media (prefers-reduced-motion: reduce)` guard citing T9 — which is
> marked fixed, with the `unguarded-animation` lint rule gating at 0. T9's own body already said
> the opposite of this sentence.

The judgement stands on its own without those two facts: a perpetual pulse reports nothing, and it
should stop once it has said what changed.

*Evidence: judgement · T9 · six `infinite` declarations across `FreshnessBadge.module.css` and `AutopilotRail.module.css`*
