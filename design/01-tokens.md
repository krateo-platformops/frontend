# Layer 1 — Tokens

The values here are correct and the light/dark parity is structurally guaranteed. What is missing is *adoption*: four of these ten rules describe a token that exists and is not used.

### T1 — Colour comes only from `color` / `colorDark`. Never a hex literal.

**Status:** holds — and now at zero across `ui/src`, not just `ui/src/widgets`.

The four that remained outside the widget tree were both worth fixing on their own merits, which
is the argument for the rule rather than an application of it:

- `Login.module.css` set `color: #ffffff` three times on the marketing panel. White was *correct*
  there — the login gradient is theme-INVARIANT (`menubgstart`/`menubgend` are identical in
  `color` and `colorDark`), so a theme-aware text token would put dark text on a dark ground in
  light mode. The fix was a token that is invariant for the same reason: `onmenubg`, measured at
  7.15:1 and 14.05:1 against the two stops.
- `Form.module.css` set `color: #ccc` on a non-interactive anchor label. That measures **1.61:1**
  on a light ground — far below AA's 4.5 for body text, so the label was very nearly invisible in
  light mode. `faint` is the de-emphasised-text token and is contrast-checked: 5.10:1 / 4.94:1.

So one hex was a missing token and the other was an accessibility defect wearing the same clothes.
A hex literal hides which it is; a token cannot.

Verified by sweep: all 168 files under `ui/src/widgets` contain exactly one hex literal, and it is inside a comment. Light/dark parity is enforced by the type system — `colorDark: Record<keyof typeof color, string>` rejects both missing and extra keys, so the two key-sets cannot drift.

*Evidence: #49 · #52 · verified `tokens.ts` `color.onmenubg` / `colorDark.onmenubg`*

### T2 — Density comes from the antd component overrides — for the 15 widget kinds those overrides actually cover.

**Status:** partial — **and the rule is not holding**

Reworded from an earlier, over-confident version of this rule. `buildComponents` governs **15** antd
kinds: `Button, Card, DatePicker, Drawer, Input, List, Menu, Modal, Progress, Select, Statistic,
Steps, Table, Tabs, Tag`.

> **Re-measured 2026-09-14: `ui/src/widgets` holds 46, not 43, so 31 self-style rather than 28.**
> Three widgets have been added since this rule was written and none of them added a
> `buildComponents` entry or documented an opt-out — which is the rule below, unenforced. Worth
> stating plainly because it is this document's own thesis: *writing the rule down is necessary and
> not sufficient.* T2 has no lint behind it, and the drift is the predictable result.

**The 31 are not one population, and the distinction is what makes this actionable.** 19 of them
share a name with a real antd component and could take an override today:

> `Alert, Badge, Breadcrumb, Checkbox, Col, Descriptions, Divider, Flex, Form, Image, InputNumber,
> Layout, QRCode, Radio, Result, Row, Slider, Switch, Upload`

The other 12 are charts, composites or have no antd counterpart at all, and are **legitimate
opt-outs** rather than debt: `BarChart, ButtonGroup, Filters, FlowChart, LineChart, Markdown,
PageHeader, Paragraph, PieChart, RangePicker, Theme, YamlViewer`.

So the real figure is **19 candidates, not 31 defects** — and `Form` is the one to do first, both
because it hand-rolls 19 padding/margin and 5 font-size declarations with no theme backing and
because it is the most CR-authoring-critical widget in the set.

**Rule:** a new widget either adds a `buildComponents` entry or documents why it opts out.

**Now enforced** — `lint-css-tokens.py` rule `widget-theme-coverage` (T2) diffs the `ui/src/widgets`
listing against the theme object and gates on a baseline of the 19, so a *new* antd-wrapping widget
without an entry fails CI while the existing debt burns down. A widget counts as antd-backed only if
it imports its own namesake (`Alert as AntdAlert` in `widgets/Alert`), which is what keeps the 12
composites silent without a hardcoded exemption list that would rot as antd grows.

The lint's 19 were derived independently of the hand count above — by import inspection rather than
by matching names against a list of antd's exports — and agree exactly, which is the only reason to
trust either number.

*Evidence: verified `tokens.ts:363-410` vs the widget directory listing · this is why #54 §0.5 and #72/#76 had to be fixed as one-offs*

### T3 — One type scale, and it must be the one that is used.

**Status:** severe → **swept, one raw value left**

> **Corrected — the figures below were badly out of date, and in the direction that flatters
> nobody: this rule described a sweep as un-started that had substantially happened.** It claimed
> the canonical scale had "zero consumers anywhere" and that "95 of 140 declarations bypass both".
> Measured today across `ui/src`: **140 `font-size` declarations, 91 on the canonical
> `--krateo-text-*` scale, 43 on the legacy `--font-size-*`, and exactly one raw px value**
> (`Paragraph.module.css`, `26px`, which is one of the two entries in `design/lint/css-baseline.json`).

Two scales still ship side by side, and the legacy 6-step `--font-size-*` still has 43 consumers, so
the retirement is unfinished. But the canonical 12-role scale from
[#49](https://github.com/krateo-platformops/frontend/issues/49) — `text-display:64` … `text-body:15`,
emitted as `--krateo-text-*` — is now the majority scale, and the lint holds the line at a baseline
of 2.

**Twenty of those 91 were dead until recently**, and are the reason this rule is worth re-reading
rather than just re-counting. They named `--text-body`, `--text-body-sm`, `--text-caption`,
`--text-body-lg` and `--text-label-xs` — the role names *without* the `--krateo-` prefix, which
nothing defines. Each was dropped at computed-value time and the element silently inherited its
parent's size. They passed the T3 gate because `var(` was a blanket exemption that never checked
whether the referenced property exists. The gate now resolves every reference against the properties
`tokens.ts` actually emits.

*Evidence: measured across `ui/src` · the legacy scale is emitted from `typography.size`, the
canonical one from the `KRATEO_BASE` text roles, both in `tokens.ts` · extends #54 §0.7*

### T4 — Spacing resolves to `var(--spacing-*)`; a raw value must equal one of 4 / 8 / 16 / 24 / 32.

**Status:** severe → **fixed, and now a plain gate**

Swept to zero: `spacing` 106 → 0 and `gap` 22 → 0 across `ui/src`, one commit per file so any single rounding reverts alone. The rule applied throughout was *snap to the nearest step; where a value sits exactly between two steps, round up* — no value moved by more than 4px. `lint-css-tokens.py` now runs with an empty baseline for both rules, so this is enforced rather than tracked.

Two exemptions were added along the way, both because the rule was asking the wrong question: a NEGATIVE margin is an offset, not spacing (the screen-reader-only idiom needs its `-1px`), and a value made only of `0`/`auto` is not a length at all (`margin: auto 0` was the last "violation" standing).

**30 of 225** padding/margin declarations use the token; **35 of 104** `gap:` declarations do. So 195 and 69 respectively are hardcoded — 87% and 66%. And the raw values don’t cluster on the scale: the most common are 12, 10, 7, 6, 2, 5px.

> **Corrected.** An earlier version of this rule said `gap:` was "69 of 69 hardcoded — never used once". That was wrong: 35 declarations do use the token, including seven in `Card.module.css` alone. The adoption gap is real and large; it is not total, and overstating it made the rule easier to dismiss than the true figure deserves.

*Evidence: verified `tokens.ts` `export const spacing` · worst offenders `AutopilotRail.module.css` (59), `Form.module.css` (19), `Select.module.css` (10)*

### T5 — Line-height is a role scale, and cross-font baseline drift is corrected at the font metrics.

**Status:** gap → **resolved by removing the mechanism**

> **Decided (Diego): retire the second family.** The drift this rule is about is Barlow Condensed's
> ascent/descent against Inter's baseline. Rather than correct for it with `ascent-override` /
> `descent-override`, the display role now uses Inter — the same family as body — so there is no
> second set of metrics to drift against. Display is carried by size, weight and tracking instead.
>
> The alternative considered and rejected was a fifth per-component patch. The symptom had already
> been patched four times (`#78 reiteration 4` is written into `Paragraph.module.css`), which is
> the signature of treating a symptom; each round cost a report-and-fix cycle and none of them
> touched the cause.
>
> **One judgement call**, recorded because it is the only non-mechanical part: the title
> `line-height` was `1.1`, chosen for Barlow Condensed's condensed line box. That is too tight for
> Inter, so both title paths (`strong: true` and `level: N`) are now `1.2` — the standard heading
> ratio for the family in use, and the same value on both paths so a title does not change height
> depending on which path rendered it.
>
> Also removed: `Barlow+Condensed` from the Google Fonts `@import`, which is one fewer font file on
> every page load.

The `typography` export has `family`, `display`, `mono`, `size`, `weight` — and **no `lineHeight` keys at all**. 32 hardcoded `line-height` declarations exist across 10 distinct values.

The root cause [#86](https://github.com/krateo-platformops/frontend/issues/86) identified — Barlow Condensed’s ascent/descent against Inter’s baseline — is untouched: `ascent-override`, `descent-override` and `@font-face` return **zero hits repo-wide**. Both visible symptoms were patched per-component instead; the mechanism that produced them is unchanged and will produce more.

*Evidence: verified `tokens.ts` `export const typography` · `Paragraph.module.css` still carries a hand `line-height: 1.1` citing “#78 reiteration 4”*

### T6 — Viewport breakpoints come from one shared token.

**Status:** gap → **corrected: this is a ratchet, not debt**

The original entry read as work to be done. It is not, and the lint says so in its own docstring: **CSS custom properties are not permitted inside an `@media` condition**, so "use the token" is unimplementable here. What `rule_breakpoint` does instead is stop a SIXTH value appearing — the five that exist (1024/640, 1180/960, 768) sit in the baseline and a new one fails.

Consolidating those five onto a scale remains a real improvement and a real design decision, because each one is a layout collapse point somebody chose. It is not token debt.

No breakpoint token exists. Four components each invent their own — 1024/640, 1180/960, 768 — **no two sharing a value**, and nothing documenting which is the tablet or mobile line.

*Evidence: verified: `tokens.ts` exports no breakpoint · `AutopilotRail.module.css:112,118` · `CommandPalette.module.css:28,44` · `Login.module.css:112`*

### T7 — Every semantic colour pair used for real text is pinned by a contrast test.

**Status:** active failure → **fixed**

> **Resolved since this rule was written.** `faint` is now per-mode (#6E6E6E light / #8A8A8A dark), ≥4.68:1 on every surface in both modes, and the suite is table-driven over all 24 text×surface pairs. Landed in PR #195; verified failing on the old value before restoring.

`tokens.contrast.test.ts` pins exactly one pairing — the primary button. Computing the rest from shipped hex found a **live WCAG AA failure**: `color.faint` = `#7A7A7A`, the one greyscale key identical in both modes, is used at 12–14px in seven places in `CommandPalette.module.css`.

| Surface | Ratio | AA normal (4.5) | AA large (3.0) |
|---|---|---|---|
| on `panelbg` #FBFBFB | 4.15:1 | FAIL | pass |
| on white | 4.29:1 | FAIL | pass |
| on dark #141414 | 4.29:1 | FAIL | pass |
| on `background` #F5F5F5 | 3.94:1 | FAIL | pass |

It passes at large sizes, so the fix is either darkening the token or restricting it to ≥24px. A table-driven test over every declared semantic pair would have caught this by construction.

*Evidence: independently recomputed · `tokens.ts:45` and `:93` both `#7A7A7A`*

### T8 — No two palette keys share a value without a documented reason.

**Status:** ungoverned → **the silent half is now enforced; the `info` collision is still open**

37 keys resolve to 25 distinct values in light mode. `warning = orange = amber = gold` is a four-way synonym; `success = green`, `error = red`, `accent2 = cyan = teal`.

Two consequences worth deciding on rather than inheriting:

> **Re-measured 2026-09-14, and the first conclusion was wrong.** The synonym keys look dead —
> nothing in `ui/src` imports `darkBlue`, `amber`, `cyan`, `red`, `green` — so deleting them read as
> free cleanup. They are not dead. `getColorCode(colorName)` resolves a **string from a widget CR**
> against the palette, so these are the CR-facing colour VOCABULARY, not internal constants. The
> charts use `gray`×5, `cyan`×5, `red`×4, `orange`×3, `green`×2 — deleting four of them would have
> turned 14 live CRs near-black.
>
> **Near-black, and silently:** `getColorCode` returns `palette.dark` on a miss, with no error. A
> typo (`color: blu`), a renamed key, or a deleted one all render as almost-black text that reads
> like a styling choice. That is the more serious half of T8 and it is now **enforced** by the
> `colour-vocabulary` lint rule, which accepts both live authoring forms (`color: red` and the
> legacy `var(--red-color)` alias) and ignores `{…}` itemTemplate placeholders. 0 violations across
> both charts, so it lands as a ratchet rather than a debt baseline. The embedded key list is
> asserted against the real `tokens.ts` by `test_lint`, so an upstream rename cannot make the rule
> start rejecting valid CRs.

**The collision that remains, and it needs a brand decision rather than work:**

**`info === primary` in both modes** — so an informational status Tag is pixel-identical to a clickable primary. Colour alone cannot separate “status” from “interactive”.

**`darkBlue` does not follow dark mode.** It equals `info` and `primary` in light, but stays `#05629A` while the other two move to `#2FBFE6`. A token authors reasonably treat as interchangeable silently diverges in one theme.

*Evidence: computed from `color`/`colorDark` in `tokens.ts`*

### T9 — A looping animation respects `prefers-reduced-motion`.

**Status:** inconsistent → **fixed**

> **Fixed** (#205). `FreshnessBadge`'s two pulses — the only unguarded infinite animations in the codebase — now stop under `prefers-reduced-motion`. The dot stays visible: the state is in the hue, not the motion. The rule now gates at zero in `lint-css-tokens`.

Not absent — *inconsistent*. The voice UI guards both its animations correctly and substitutes a static state. `FreshnessBadge`’s genuinely infinite opacity pulse has no guard at all, and it renders on the “refreshing” and “live” states.

*Evidence: verified `FreshnessBadge.module.css:30,44` (unguarded) vs `AutopilotRail.module.css:999,1163` (guarded)*

### T10 — Chrome heights come from `layout.headerHeight` → `--header-h`.

**Status:** holds

The main header and the docked rail previously shared a hardcoded `64px` that matched only by coincidence.

*Evidence: #86 §0.10 — verified `tokens.ts` `export const layout`*

---

## The sweep plan (T3 · T4)

Audited 2026-09-12 across the 48 CSS modules. The headline is that **the sweep is not a
substitution** — most hardcoded values have no token to substitute *to*, and that is the finding
rather than an obstacle to it.

### Font sizes — 16 of 92 substitute cleanly

| | count |
|---|---|
| Map directly onto a token (`12px`, `13px`, `15px`) | **16** |
| Off-scale | **76** |
| …of which: the micro-label tier | **52** |

The 52 are `9.5px` ×12, `10px` ×11, `10.5px` ×12, `11px` ×17, and they sit overwhelmingly inside
**uppercase or mono blocks** — 11 of 11, 9 of 12, 11 of 12, 13 of 17. That is the C17 micro-label
idiom: column headers, card eyebrows, status captions.

Two things follow, and together they decide the approach:

- The canonical scale's floor *was* `text-caption: 12px`, so the product's densest typographic tier
  had no token at all. These values were not drift *from* the scale; they were below it.
  **This has since been addressed**: `text-label-sm: 11px` and `text-label-xs: 10px` now exist in
  `tokens.ts`, and the half-steps `xxs`/`xsm`/`smd` were added to `spacing`.
- The four values span **1.5px**. That is not four deliberate tiers — it is one tier that drifted
  because nothing named it.

**Decision: extend, do not round.** Rounding 52 declarations up to `12px` would visibly inflate
every column header and status chip in the product, and would destroy a tier that twelve files
independently converged on — the same twelve that also agreed, unprompted, on
`letter-spacing: 0.08em`. Naming it costs two tokens and makes 52 declarations mechanical.

### Spacing — 49 of 211 are clean

```
6px ×17    12px ×12    5px ×11    2px ×10    10px ×9    7px ×8
```

`6` and `12` are exactly the **half-steps the scale skips**: it doubles 4 → 8 → 16, and a dense
console keeps reaching for what lies between. Adding `2`, `6` and `12` makes 39 more declarations
clean. `5`, `7` and `10` genuinely are drift and should round to their neighbours.

**The number that matters for planning: 85 of the 162 off-scale spacings are multi-value
shorthand** — `2px 8px`, `0 6px`, `8px 10px`. Those are compound, often legitimately asymmetric,
and need per-case judgement rather than substitution. That is where the time goes, not in the
single-value replacements.

### Order of work

1. ~~**Add the tokens first** — ~2 label sizes, ~3 spacing steps.~~ **Done.** Both label sizes and
   all three spacing half-steps are in `tokens.ts` and are consumed across the widget CSS. The
   ordering argument still stands for any future sweep: nothing can be swept onto a scale that does
   not exist yet.
2. **Then the ~91 mechanical declarations**, file by file, against the lint's baseline so each file
   burns down visibly and nothing re-drifts behind you.
3. **Then the shorthand and the one-offs**, which need eyes on each.

The lint (`lint/lint-css-tokens.py`) exists so step 2 can happen incrementally instead of as one
large untestable diff — its baseline shrinks as files are done, and CI catches anything new.

### What this audit corrected

The plan before it was "replace ~305 hardcoded values with tokens", which assumed the tokens
existed. Two thirds of them do not. **Most of this work is a design decision about what the scales
are missing; the replacement is the small part afterwards.**
