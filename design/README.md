# Krateo Portal Design System

105 rules across five enforcement layers, plus composition patterns. Each rule cites a symbol, a
`file:line` or an issue section, so a reader can check it rather than take it on faith.

**Citations drift, and a stale one is worse than none** — it sends a reader to a line that now holds
something unrelated and quietly spends their trust. Prefer citing a *symbol* (`tokens.ts`
`export const spacing`) over a line number wherever the symbol is stable.

| | | |
|---|---|---|
| [01-tokens.md](01-tokens.md) | **T1–T10** | Colour, spacing, type, density, breakpoints, contrast |
| [02-components.md](02-components.md) | **C1–C25** | Shared components: what exists, what is missing, what each guarantees |
| [03-composition.md](03-composition.md) | **P1–P25** | How a page is assembled from widget CRs |
| [04-silent-failures.md](04-silent-failures.md) | **X1–X13** | Renders clean, behaves wrong — passes the CRD, the dry-run and the eye |
| [05-agent-parity.md](05-agent-parity.md) | **A1–A19** | What Autopilot may do, what a page owes it, what it owes back |
| [06-composition-patterns.md](06-composition-patterns.md) | **G1–G13** | Page archetypes, widget selection, and a stated design position |

## Why this exists

Between 2026-07-20 and 2026-09-07, fourteen UX issues were filed against the portal containing
**81 discrete findings**. Classified by root cause rather than by page, **58 of them (72%) fall
into eleven recurring classes**. Only 23 are genuinely page-specific.

The clearest exhibit is [#76](https://github.com/krateo-platformops/frontend/issues/76), an entire
issue whose only content is that a defect already filed against Incidents also appears on Alerts.
That is a design system being run by hand — the same review performed fourteen times, re-finding
the same eleven problems, because there was nowhere to write the answer down once.

Three of the issues ask for the missing piece by name: *"no dedicated page-header component exists
to point to"* ([#72](https://github.com/krateo-platformops/frontend/issues/72) §0.1), *"consider
whether a shared 'title + tags' pattern is worth standardizing… so this class of bug doesn't need
re-fixing"* ([#78](https://github.com/krateo-platformops/frontend/issues/78) §0.3), *"a single
shared 'header icon button' style would prevent this"*
([#80](https://github.com/krateo-platformops/frontend/issues/80) §0.7).

And the counter-example proves the model. `Breadcrumb` and `DrawerHeader` *were* centralised — and
stopped generating findings. #78 §0.1 records the payoff in one line: **"fixing it here fixes every
page's breadcrumb."**

## Why it lives here

The frontend repo defines the vocabulary — tokens, components, widget schemas, CRDs — and **28
charts consume `widgets.templates.krateo.io`**, several of which are templates that new portals are
cloned from. A design system living in any one consuming chart would govern one of twenty-eight.

The trade-off, named: CR authors work in the chart repos and will not read a document here. The
composition lint is what bridges that — it ships from this repo and runs in a chart's CI, so the
P-rules arrive as a failing check with a link, at the moment they matter.

## The deeper pattern this documents

The same failure appears three times, one level up from any individual defect. A thing was built,
and then nothing consumed it:

- **The type scale.** [#49](https://github.com/krateo-platformops/frontend/issues/49) shipped a
  12-role scale as `--krateo-text-*`. *This entry used to read "zero consumers across every CSS
  module" — it is now the majority scale: 91 of 140 `font-size` declarations, against 43 still on the
  legacy `--font-size-*` and one raw px. See T3.*
- **The spacing scale.** 30 of 225 padding/margin declarations use the tokens (87% hardcoded) and
  35 of 104 `gap:` declarations do (66% hardcoded). Adopted in places, ignored in most.
- **The containment grammar.** `allowedResources` is declared on seven containers and enforced by
  nothing: not by OpenAPI, not by a webhook, not by the renderer.

A token nobody consumes and a mockup in a Downloads folder fail the same way. **Writing the rule
down is necessary and not sufficient — the rule has to be load-bearing.** That is what the
enforcement notes on each layer are for, and it is the standard this document should be held to.

## Where to start

Two things retire the most recurrence per unit of work:

1. **Adopt `PageHeader` (C5).** The component is built and merged; adopting it collapses 46
   hand-rolled header CRs to about 14 across roughly a dozen chart pages. Six composition rules stop
   being rules you must remember and become defaults you cannot get wrong. It is also the fix for
   the most visible inconsistency in the product: two pages about operational events build the same
   chrome from different primitives under three different names.
   **Gated on a frontend release** — a chart CR referencing `kind: PageHeader` needs the CRD on the
   cluster first.
2. **Add the missing scale steps, then sweep (T3, T4).** The lint now exists, so the sweep can run
   file by file against its baseline instead of as one large untestable diff. But [the audit](01-tokens.md)
   found most hardcoded values have no token to move *to*: two label sizes and roughly three spacing
   steps have to be **added first**, and choosing them is a design decision rather than a mechanical
   one. After that ~91 declarations are mechanical and the rest needs eyes.

**Not on this list any more:** X2's RBAC residual. A denial reading as absence is now a
[decided position](04-silent-failures.md), not a gap — announcing hidden items would leak the
existence and count of resources outside a tenant's scope.

## What is enforced today

Two lints run from [`lint/`](lint/), and between them they hold **ten composition rules and seven
token rules**. Everything else is a rule a human applies.

- `lint-portal-consistency.py` — composition, run against a chart's widget CRs. **0 violations**
  across all ten rules against the portal chart.
- `lint-css-tokens.py` — token adoption in this repo's stylesheets. Gates on a **baseline** of seven
  pre-existing violations across five files, so new code is held to the rule while the debt burns
  down.

**Both are wired into CI**, and have been since they landed: `.github/workflows/design-system.yaml`
here runs the CSS lint and both self-tests on every PR and push to `main`, and the portal repo's
workflow of the same name runs the composition lint against its rendered chart.

> This section said "Neither is wired into CI yet. Until they are, this document is still the thing
> it warns about", and quoted a baseline of 314 when the file held seven. Both were wrong for
> several releases — in the section of the design system specifically about what is verified.

## How rules are marked

- **holds / landed / exemplar** — verified true today; written down so a regression is recognisable
- **gap / open / severe** — verified false today
- **judgement** — a call, not a finding. Overrule it with your own taste; the measured rules are
  the ones with a defect behind them.

A rule marked *"Resolved since this rule was written"* carries the PR that closed it.

## Provenance

Compiled from krateo-platformops/frontend issues #49–#192, eight parallel source audits verified
against `origin/main`, and a twelve-agent census of the 612 widget CRs in
krateo-platformops/portal. Findings are counted by root cause, so a finding touching two classes is
counted in both and class totals exceed 81.
