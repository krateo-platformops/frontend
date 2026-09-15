# Layer 5 — Agent parity

The invariant: **anything Autopilot can do, a user must be able to do without it**, through ordinary buttons and forms. Autopilot may be faster; it must not be the only route.

Like Layer 4, this is a class rather than a location, and it is violated by omission — you cannot see it on a page, only by diffing two inventories. Unlike Layer 4, it cannot be checked from the frontend repo alone: it needs the chart, where the shipped pages live.

## Where the invariant stands — measured against the shipped chart

The first pass could only measure Autopilot's side. This one diffed it against **612 widget CRs on the portal chart's `origin/main`**, with every contested row handed to an adversarial verifier told to break it. The prior verdict did not survive.

| Verb | Verdict | Shipped UI route |
|---|---|---|
| navigate | PARITY | Autopilot validates against the portal's own route table, so it is a strict subset of what a click reaches |
| runAction | PARITY | By construction — and it *forces* confirmation on mutating verbs, stricter than the chart's own buttons |
| prefillForm | PARITY | All 11 shipped Forms; Autopilot never submits |
| openDrawer · explainUpgradeImpact | PARITY | Shipped drawer buttons; upgrade-impact reachable from the blueprint detail page |
| **patchField** | PARTIAL | **The GAP verdict falls.** `button.composition-detail-edit` → `form.composition-edit` merge-PATCH, reachable sidebar → table row → detail → Edit, no Autopilot in the path |
| **applyResourceSet** | PARTIAL | Narrows. `form.fleet-rollout` (`fanOutPath` → N ordered writes) and `form.access-grant` (`ops[]`, 2 writes) ship |
| setExtras · describeResource | PARTIAL | Each whitelisted key has a control — but not on every page that honours it |
| **publishBlueprint · publishPage · publishRestDef** | GAP | **0 of 612 CRs** write `gitrefs`, `repocontents` or `pullrequests`. The three builder pages ship zero write widgets — their only CTA is a navigate into Autopilot |
| the preview family | by design | Tooling that grounds the model's own generation |

**The breach is not where the first audit put it.** Both mutating verbs it called outright gaps have ordinary shipped routes — and the composition Edit drawer is *strictly more powerful* than `patchField`, reaching nested paths and many keys in one PATCH where the verb takes a single bare key. The real breach is structural and sits one level up: **the three builder pages are Autopilot-only by construction.**

> **A conditional the audit nearly missed**
>
> An adversarial verifier refuted the publish GAP, finding that `builder-publish` ships as an ordinary blueprint — so instantiating it from `/blueprints` POSTs the same `BuilderPublish` claim the rail emits. That route is real, and it is **not the one in use**: it is live only when `AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER` is `true`, and the chart sets it nowhere. The code comment says why — *“legacy github path, so existing installs are byte-identical. Flip on once git-provider + the builder-publish composition are deployed.”*
>
> So the GAP stands for what is deployed, and there is a latent route behind a flag. Worth knowing before anyone builds a publish UI that already half-exists.

### A1 — Every capability Autopilot can reach has a control a user can reach without it — and the agent presses that control.

**Status:** breached — **on both halves**. STILL OPEN, deliberately not flipped.

Measured: the invariant holds for navigation, action-driving, form filling and both contested mutating verbs. It is breached for **publishing** — and breached structurally rather than by oversight. The three builder pages ship *zero* write widgets; their only call to action is a navigate into the rail. Autopilot is not a faster path to publishing, it is the only path.

> **Re-measured 2026-09-15, and the breach is wider than the paragraph above says.** There is no
> human-pressable Publish control *anywhere in the product*, not merely none on the builder pages —
> not in the rail either. `previewSurface.tsx` renders a "Publishes to `<repo>`" tag and a Files tab
> with per-file human editing, but no publish button; `publishTargetForm.tsx` is a destination
> picker that opens *after* the model has already emitted the verb. The publish trigger is
> exclusively a model-emitted `publishBlueprint`/`publishPage`/`publishRestDef` fence. Verified on
> portal `origin/main` (`0d309f1`): each builder root holds a header Flex, an "Ask Autopilot →"
> Button whose only action is `navigate` to `?ask=`, and 1–2 read-only Tables — and
> `allowedResources: [flexes, tables]` means a Form cannot be mounted there without a CRD edit.
>
> **The closure gate**, so this cannot be flipped by something that only makes the sentence true:
> *can a user who never opens the rail author and publish a page?* Today: no. A Publish button
> inside the rail, a Form over `BuilderPublish`, or another `?ask=` link each leave that answer
> unchanged, and none of them closes A1.
>
> **What genuine closure needs**, scoped rather than started: the published bytes currently live in
> `blueprintDraftStore` — provider-owned, conversation-scoped, cleared on `newThread` — so a page
> widget has nothing to read. Half one therefore needs durable drafts plus a page-mounted publish
> Form, across the frontend store, the portal chart and the widget CRD's `allowedResources`, and it
> forces a decision on `AUTOPILOT_PUBLISH_VIA_GIT_PROVIDER` (a UI control wants the single
> `BuilderPublish` claim, not the 3-kind github op set, and flipping that changes the publish path
> for every existing install). Half two — *the agent presses that control* — additionally needs a
> primitive that can submit a Form, and today's safety story rests on Autopilot never submitting.
> That is a policy change against the standing "Autopilot drives UI only" rule and is an owner's
> call, not an implementer's.
>
> Recorded as open on purpose. The board has already been burned once by markers that said fixed
> while the defect stood (portal#263, 15 of them); this rule is the most expensive place that could
> happen again.

The distinction the first audit drew still holds and is worth keeping: every individual Autopilot write routes through the identical confirm, blast-radius and provenance fabric a Button click uses.

> The **safety** invariant holds everywhere. The **capability** invariant is breached in exactly one place — and it is a whole product surface, not a verb.
>
> — *the measured result*

## The second half, folded in 2026-09-14 (Diego)

**Autopilot must drive actions THROUGH THE UI — never through direct calls, and never through tools
that create or patch Kubernetes resources.** The agent's hands are the portal's own controls. Where a
capability has no control, the answer is to BUILD THE CONTROL, not to hand the agent a tool that
writes to the apiserver.

This is strictly stronger than the sentence above. The original rule is satisfied by a UI that merely
*exists* beside an agent tool; this one is not. The route is not an alternative path — it is the only
path the agent may take.

**Why, in the platform's own terms:** a control already carries the confirm gate, the blast-radius
diff, the provenance stamp and the caller's RBAC. A compiled write op has to re-earn every one of
those, and each re-implementation is somewhere they can silently diverge. Driving the control leaves
exactly one write path to audit.

**Measured against the shipped verbs:**

    runAction          drives a control: YES   compiles its own ops: no
    patchField         drives a control: no    compiles its own ops: YES
    applyResourceSet   drives a control: no    compiles its own ops: YES

`runAction` is the compliant shape: `lookupAction` finds a REAL mounted control and dispatches it
through the SAME `useHandleAction` the button uses — never a synthesized call.

> **`previewPage` (v2) is deliberately NOT in this table.** It compiles its own ops and drives no
> control, but the top table files the preview family under *by design — tooling that grounds the
> model's own generation*, and that classification is the right one: preview is the agent showing
> its work on drafts it just generated, not a capability a user would reach independently. There is
> nothing for it to drive. An earlier revision listed it here and called these "the other three",
> which contradicted both `:21` and the prose below that has always said two. Half (b) is
> `patchField` and `applyResourceSet`.

The other two are **honoured in safety but not in structure**. They are not bypassing anything —
every op goes through `handleAction`/`handleActionSet` and hits the identical gate, diff, stamp and
RBAC. But no control is being pressed, and that is the point of the rule: the guarantees are supposed
to come from the control, not from three separate compilers each remembering to ask for them.

**So the two halves share one fix.** Publishing has no control at all, which breaches the first half;
`patchField` and `applyResourceSet` have controls they do not use, which breaches the second. A
UI-native authoring surface closes both — it gives publishing a control, and it gives the compiling
verbs one to drive. That is the decision taken 2026-09-14: build the authoring surfaces, with the
authoring knowledge living in **widgets** rather than in frontend code.

*Evidence for the second half: measured across `actionBridge.ts` (verb branches), `patchField.ts:198`
and `applyResourceSet.ts:194` — both dispatch compiled ops via injected `handleAction`/
`handleActionSet` callbacks rather than resolving a mounted control*

*Evidence: census of 612 CRs: 22 mutating verbs across 20 files, none writing a publish artifact · 37 Buttons, 11 Forms, all examined*

### A2 — A mutating verb with no UI equivalent is named as a first-class exception — never filed under “minor preview verbs”.

**Status:** documentation

The prior working assumption was that only the three AI-authoring builders were Autopilot-exclusive, plus some minor preview verbs. Directionally right, wrong where it counts: it filed the two *mutating* gaps under “minor”. The mechanism is safe; the claim about it was not accurate.

Enforcement: CI fails when a new write verb is added without an explicit “has a UI equivalent” annotation.

*Evidence: this audit, Task C*

### A3 — An Autopilot entry point is a plain Button wired to `navigate` → `?ask=<prompt>`.

**Status:** holds

Autopilot must never require a bespoke widget or private API to be invoked from a page — and it doesn’t. The deep link opens the rail and seeds one turn; the mechanism is a URL convention a CR author wires like any other button.

Page context is **not** passed by the entry point. It is snapshotted from the live widget cache at send time regardless of how the turn started, so an entry point’s only job is to supply prompt text.

*Evidence: verified `askDeepLink.ts` · `useAutopilotContext.ts:1-10`*

### A4 — One canonical label for “open Autopilot with a seeded prompt”.

**Status:** gap → **resolved**

> **Corrected, then resolved.** This rule recorded FOUR label variants on medium confidence. Measured against the chart there were **three** across six CTAs — “Ask Autopilot →”, “Investigate with Autopilot”, “Diagnose with Autopilot”. “Troubleshoot with Autopilot” does not exist.

> **And then it drifted again, within the same merge window.** A seventh CTA landed labelled "Author with Autopilot" — a fourth variant, authored before the decision and merged alongside the fix (portal#152 corrected it). Worth keeping because of WHY the sweep missed it: it matched Buttons containing a literal `ask=`, and this one gets its deep link from the RESTAction via `askHref` in a widgetDataTemplate. **A pattern-based sweep finds the shape it was written for, not the capability** — which is the argument for checking what a CR *does*, in the lint, rather than what it contains.
>
> All six now read **“Ask Autopilot”** (krateo-platformops/portal#151): it describes what the *button* does, where the other two described what the page was about.
>
> **The rule governs button labels only.** `listy.alerts-hint` is a described strip with a detail line rather than a button, and its title (“Author an alert with Autopilot”) is deliberately not the canonical label. A sweep that treats every Autopilot-adjacent string as a CTA label will flag it wrongly.

Four variants for the same mechanism: *“Ask Autopilot →”* (builder pages), *“Investigate with Autopilot”* (alert detail), *“Diagnose”* (composition detail), *“Troubleshoot with Autopilot”* (observability).

*Evidence: #84 §0.1 · #83 §0.8 · #86 §0.9 · `askDeepLink.ts:3-4`*

### A5 — The CTA is scoped to the smallest container it is actually about, right-aligned within it, and competes for that container’s one primary slot.

**Status:** CR

A panel when it acts on that panel’s content; the page, in its own right-aligned row, when Autopilot is the page’s whole workflow. Never a bare item in a page’s top-level stack.

On primacy: it is **not** special-cased. It takes `primary` under the same rule any other single-action container does, and drops to secondary if the container gains a competing primary. This is P6 as rescoped, with no Autopilot carve-out.

*Evidence: #83 §0.8 → #86 §0.9 — the same bug pattern corrected twice, on two pages*

### A6 — A declared verb that always no-ops must be implemented or removed.

**Status:** gap → **decided** — **residual:** refusal chips still render as successes

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/components/Autopilot/AutopilotRail.tsx:183-190` — every action chip, refusals included, renders the cyan success checkmark. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

> **Decided, and the underlying defect fixed** (#204). The stubs STAY declared: removing them changes nothing, because an unregistered verb returns null too — so the real defect was the silence, not the declaration. And they must NOT be implemented: the drawer capability is already reachable via `runAction` against a shipped Button, so a dedicated verb would let the agent open a drawer for a ref no button exposes — creating a Layer 5 gap rather than closing one. `refused()` in `actionBridge` turns a null into a chip naming the verb — for the **read-verb registry path**.

> **Corrected.** This blockquote claimed `refused()` "covers unknown verbs, failed schemas and
> unmounted controls alike". It does not cover the last one. The `refused()` fallback is applied
> only on the `READONLY_VERB_REGISTRY` path; `runAction` is handled by an earlier branch that
> returns a bare `null` when `lookupAction` finds nothing, and `runAction` is not a key of that
> registry, so it never reaches the fallback. Exactly one refusal path is still silent, and it is
> the one this sentence named as covered — see A18, which describes it as an open gap.

`openDrawer` and `openModal` are registered as read verbs whose apply always resolves null. The UI supports both natively — this is the inverse gap, and it is worse than an absent verb, because the model is taught a capability that silently does nothing.

*Evidence: verified `verbRegistry.ts:129-141`*

### A7 — The header toggle is chrome, and never counts against a page’s primary-action budget.

**Status:** holds

It sits outside any page-content subtree, placed last behind a divider, in brand primary rather than the warning token it once borrowed.

*Evidence: #56 — verified `Shell.tsx:36`*

### A8 — The agent’s activity state is visible wherever the agent is.

**Status:** open → **fixed** — **residual:** the indicator clears before the action phase

> **2026-09-15 reconciliation.** The transition above is real but over-claimed: a live counterexample remains. `ui/src/components/Autopilot/AutopilotToggle.tsx:28,50` — bound to provider `streaming`, which `AutopilotProvider.tsx:297` clears BEFORE the agent's action phase begins. Verified by an adversarial pass whose brief was to refute the closure, not to confirm it — 15 of 18 markers examined failed that way, which is the direction that matters, since a rule marked fixed is a rule nobody re-checks.

> **Fixed** (#204). The header toggle consumes `streaming` and shows the reserved agent-signal token, with `aria-busy` for screen readers. STATIC, not blinking: the rail's caret blinks because it sits at the end of streaming text where motion reads as "more is coming", but a permanent blink in the page header is the looping animation G13 rules out.

Found independently by two audits. The in-rail caret correctly uses the reserved agent-signal token, guarded by three separate comments against reuse. The header toggle — the one permanently-visible entry point — never consumes `streaming` at all, so it cannot show that a turn is in flight.

*Evidence: verified `AutopilotToggle.tsx:19-20` vs `AutopilotRail.module.css:485-497`*

### A9 — The rail’s hand-built primitives track the token set deliberately, because they inherit nothing.

**Status:** risk — **narrowed by measurement; the original claim was false**

> **Re-measured 2026-09-14.** This rule read "the rail imports **zero** antd components — every
> control is a raw element", citing "no antd import in `AutopilotRail.tsx` except `Tooltip`". That
> is not true and may not have been true for some time. Of **11** non-test `.tsx` in the Autopilot
> tree, **6 import antd**, using **14 distinct components**: `Typography`, `Tooltip`, `Form`,
> `Input`, `Tour`, `Alert`, `Button`, `Collapse`, `Drawer`, `Empty`, `Space`, `Tabs`, `Tag`,
> `Modal`. Most of the rail's surface already inherits antd theming.
>
> Scoping work against the old sentence would have sized a 1,176-line rewrite. The real residue is
> **29 controls in 4 files**.

**What is actually true, measured:**

    AutopilotRail.tsx        16 raw <button>, 1 <input>, 1 <textarea>    antd Button imported: NO
    SpeakBackControls.tsx     6 raw <button>                             antd Button imported: NO
    VoiceControl.tsx          3 raw <button>                             antd Button imported: NO
    AutopilotToggle.tsx       2 raw <button>                             antd Button imported: NO

The duplication is **concentrated in the rail's own chrome** — the transcript controls, the voice
and speak-back toggles, the rail toggle — and none of those four files imports antd's `Button` at
all. Everything else (drawers, tabs, forms, alerts, tags) is already antd.

**The CSS discipline is holding**, which is the part worth not panicking about: 639 declarations,
317 on a token (49%), **zero raw hex**, and the file is already covered by `lint-css-tokens`
(T1/T3/T4/T6/T9) with 0 violations. A colour cannot drift here without failing CI today.

**So the residual risk is narrow and specific:** those 29 controls are a second implementation of
`Button`/`Input` that antd theme changes do not reach. Not all are duplicates — an expandable
evidence row (`apEvRow`) or a starter chip (`apSg`) is genuinely bespoke and a `Button` wearing a
costume would be worse. The honest fix is to classify the 29, convert the true duplicates under a
**rail-scoped antd `ConfigProvider`** carrying the glass treatment as a theme override, and leave
the bespoke ones documented as bespoke. That answers the original justification — "stays legible in
both themes" — rather than overriding it.

*Evidence: measured across `ui/src/components/Autopilot/**/*.tsx` (11 non-test files) and
`AutopilotRail.module.css` (1176 lines, 639 declarations)*

## What a page owes Autopilot

Everything above governs how a page *invokes* the agent and what the agent *may do*. The inverse direction — what a page and its widgets must **offer** to be legible and drivable — is a real contract with real authoring consequences, and it was entirely undocumented.

The collector reconstructs what Autopilot can see from the **live widget cache**, at send time, scoped to what is on screen. That single design choice makes several CR-authoring decisions silently decide what the agent can reason about.

### A10 — A page's agent-visible surface is its *mounted* widgets — so tabbing a page hides content from Autopilot too.

**Status:** CR

The collector scopes to `type: 'active'` — queries with a mounted observer — deliberately, so widgets from other pages visited in the last few minutes don't leak in and ground the agent on off-page data.

The consequence nobody writes down: **a widget on an unvisited tab is not in the context at all.** Choosing Tabs (P8) removes those panes from the agent exactly as it removes them from Ctrl-F. That is a real cost to weigh against the ones P8 already lists, and it argues for stacking on any page whose whole picture the agent is expected to reason about.

*Evidence: verified `useAutopilotContext.ts:488-499`*

### A11 — The agent sees the first array field and its first 30 rows. Put the answer above that line.

**Status:** CR

`MAX_ITEMS = 30` row labels per list or table, taken from the first of `dataSource` / `items` / `data`. Cell text is joined and cut at 300 characters, descriptions at 700, and a page envelope caps at 120 widgets.

So a table whose default sort buries the interesting row at position 31 makes the agent blind to it, and a widget holding its rows under some other key is invisible to row sampling entirely. **A default sort is an agent-grounding decision, not only a reading-order one.**

*Evidence: verified `useAutopilotContext.ts:27,73,119,142,163`*

### A12 — Load and error state travel with the data, so the agent can say “still loading” instead of “none”.

**Status:** holds

The collector reads query *objects*, not just data, and carries freshness plus the errored render state. Without it a widget mid-fetch, a stale snapshot from a stale-while-revalidate cache, or a failed fetch all look like ground truth — and the agent reports “0 compositions” or confabulates a cause while the list is still loading.

This is a designed anti-confabulation property and a fragile one: any change that passes data without its state reintroduces the failure. It is also what lets Autopilot answer “why isn’t the page loading?” rather than guess.

*Evidence: verified `useAutopilotContext.ts:495-499` · large row counts are flagged as a client-render hazard after a list wedged a tab at ~60k rows*

### A13 — An action id is a public API: stable, named for what it does, never casually renamed.

**Status:** CR

`runAction` resolves `{widget, actionId}` out of the live cache and dispatches the found action through the same dispatcher a click uses. Rename an id and the capability disappears — no error, no warning, the verb just becomes a no-op. Same silent-failure shape as P10's inert row, one layer up.

*Evidence: verified `actionBridge.ts:397-408`*

### A14 — Nothing reaches the agent except through the redaction chokepoint.

**Status:** holds

One pure function runs **last**, just before the envelope is serialized: denylisted keys (token, authorization, bearer, password, secret, credential, apiKey, jwt, accessToken) become `[redacted]`; JWT-shaped strings and long base64 blobs — Secret `data.*` payloads — are scrubbed anywhere they appear.

Its own header calls it the defensive last line “so a future collector change cannot silently leak”. Codified here so the chokepoint stays single: a second serialization path that skips it would be invisible in review.

*Evidence: verified `redact.ts:1-15`*

## What Autopilot owes a page

The reciprocal of A10–A14. A page makes itself legible to the agent; the agent has obligations back — to leave the page correct, to ground what it says in what it saw, and to be accountable for what it changed. Three of these hold and are worth protecting; two are open.

### A15 — An agent write converges the page, exactly as a click does.

**Status:** holds

The bridge compiles a proposal to a canonical action and drives **the same dispatcher a click uses**, so it inherits RBAC, the blast-radius confirm, and the post-write revalidation — including the staggered background refetches at 800ms and 2200ms that exist because snowplow can read a just-written object through an informer that lags the write, so a single immediate refetch lands on pre-write state.

The consequence worth naming: **Autopilot never leaves a page showing stale data after its own write.** Any future write path that bypasses the dispatcher loses all of this silently.

*Evidence: verified `actionBridge.ts` (“Reuses `useHandleAction`”) · `useHandleActions.ts:33-42`*

### A16 — The agent speaks from the envelope, not from memory.

**Status:** holds

The collector is stateless and snapshots at send time, so what the agent can say is bounded by what the page actually showed at that moment. It carries load and error state alongside the data precisely so a loading list cannot be mistaken for an empty one (A12).

This is the property that makes “what does this page say?” answerable rather than plausible. It is also what a page breaks when it hides content behind a tab (A10).

*Evidence: verified `useAutopilotContext.ts:2-8,488-499`*

### A17 — An object the agent created is identifiable as such.

**Status:** gap → **fixed** ([#243](https://github.com/krateo-platformops/frontend/pull/243))

> **Corrected — this rule described as an open gap something that had already shipped.** It read
> "`applyResourceSet` stamps nothing" after the stamp was merged, which is the same drift this
> document warns about in its own preamble: a stale status is worse than none, because a reader
> who checks one citation and finds it wrong discounts the rest.

An agent-originated CREATE is now stamped `krateo.io/created-by: autopilot`
(`provenance.ts` `AGENT_CREATED_LABEL`, applied in `useHandleActions.ts` via `stampAgentCreated`).

Three properties of the fix are load-bearing and worth not regressing:

- **CREATE only.** A `POST` brings an object into existence and the label describes that act. A
  `PUT`/`PATCH` edits something that may well have been created by a human, and stamping there
  would assert something false. An object *edited* by the agent is a different fact, and the
  AuditRecord is where it belongs.
- **Stamped BEFORE the HITL gate**, deliberately — so the blast-radius diff the human confirms
  *shows* the label. An agent that added a field to the body after approval would be doing exactly
  what the gate exists to prevent, even for a field this harmless.
- **Never mutates the caller's payload**, and leaves a payload whose `metadata` or `labels` is not
  an object exactly as it found it rather than corrupting a shape it does not understand.

The original reasoning for the rule stands and explains why parity with an unmarked human click was
never the right read: **the agent acts under the caller's identity**, so without the label the audit
trail attributes its writes to the human. Attribution was not merely absent, it was misleading — and
an agent can create ten objects in a turn the user approved as one aggregate.

A human’s click is equally unmarked, so this could be read as parity. It is not, for one reason: **the agent acts under the caller’s identity**, so the audit trail attributes its writes to the human. Attribution is not merely absent, it is misleading — and an agent can create ten objects in a turn the user approved as a single aggregate. “Why does this object exist?” has no answer.

*Evidence: `provenance.ts` `stampAgentCreated` + `AGENT_CREATED_LABEL`; call site `useHandleActions.ts`; covered by `provenance.test.ts` — "A17: an agent-created object is identifiable without a join"*

### A18 — A verb that cannot act says so.

**Status:** gap → **fixed, with one sliver named below**

Two silent no-ops reached the user as nothing at all: a dead declared verb (A6), and a `runAction`
whose target control is not mounted. A6 was closed by #204's `refused()` helper; this rule was the
remainder.

**The fix reuses `refused()` rather than inventing a channel** — it is already the house answer for
"a verb declined", already renders in the rail as a read-only line, and is already excluded from
speech, so a refusal gains no voice-narration side effect. It now takes an optional reason, and the
no-reason label is **byte-identical** to #204's wording so existing refusals are not silently
reworded (locked by a test).

Three branches stopped returning a bare `null`: `runAction` (the A18 case), `patchField` and
`previewPage`. `lookupAction` returns null when no *cached widget of that name carries that action
id*, so the reason is worded "no such control on this page" rather than "not mounted" — the lookup
never observes a lifecycle and should not claim to.

**The sliver, stated rather than quietly left:** `applyResourceSet` still returns a bare `null`,
deliberately. Its null means *either* a scoping-kernel reject *or* the human declining the W0-4
blast-radius confirm, and the two are indistinguishable at the call site. A blanket refusal chip
there would accuse the portal of refusing a decision the user had just made — a worse answer than
silence. Splitting that null into denied-vs-declined is what remains.

> **Found while fixing this, and worse than the rule it sits under:** a `runAction` whose
> confirmation the user *declines* still returns a **success** chip claiming the action ran
> (`handleAction` returns void, so the decline is invisible to the bridge). A18 was about silence;
> this is a false positive, and it is not fixed here.

The unmounted-control case is the same silent-failure shape as P10’s inert row and A13’s renamed action id, and it is the one most likely to be read as the agent ignoring the request.

*Evidence: verified `actionBridge.ts:397-408` · `verbRegistry.ts:129-141`*

### A19 — The agent leaves the page’s own state and the cluster as it found them, minus what it was asked to change.

**Status:** partly

**Page state: holds.**

> **Corrected.** This read "**breached** — `setExtras` rebuilds the query string from its own
> proposal, discarding every URL param it did not set — see X9", and cited X9 as its support. X9
> says the opposite, in bold: *"Corrected — this was published as a defect and is not one."* The
> code agrees with X9. `buildExtrasPath` does build a bare `pathname?whitelisted-only` URL, but
> `setExtrasSpec.apply` dispatches it as a `navigate` action, and the navigate dispatcher seeds a
> fresh `URLSearchParams(window.location.search)` and overlays only the keys the proposal set. The
> params the agent did not touch survive. Two rules in the same design system asserting opposite
> things about one function, one of them citing the other as evidence, is the failure worth
> recording here.

**Cluster debris: designed, with a known hole.** Preview drafts are swept on the next preview and torn down on drawer close, epoch-guarded so a stale close cannot delete a newer preview. But the contract is explicitly best-effort — “a failed delete is the janitor’s problem” — and teardown fires on *drawer close*, so a session that dies without one leaves its drafts until the next preview or an external janitor. Worth knowing rather than discovering.

*Evidence: verified `previewPageV2.ts:13-23,116-125` · X9*
