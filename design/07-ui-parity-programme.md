# Total UI parity — removal and build plan

**Decision (owner, 2026-09-15):** Autopilot and its sub-agents lose every tool that can
create, patch or delete Kubernetes resources, or create, update, roll back or delete Helm
releases. Every action goes through the UI, with the agent opening the right widgets and
filling them.

This is strictly stronger than rule **A1**, which asks that every agent capability *have* a
UI control. This asks that the UI be the agent's **only** means.

Sourced from a read-only audit of the live agent CRs on `krateo-057`, the frontend write
paths in `ui/src/components/Autopilot`, both portal charts, and the frontend's write-gate
implementation, all on 2026-09-15.

---

## 0. Why this is worth doing beyond the principle

The gating that currently compensates for those tools is **demonstrably leaky**. Four
ungated write paths were found on the live cluster:

| Agent | Ungated today |
|---|---|
| `helm-agent` | `helm_uninstall`, `helm_upgrade`, `helm_repo_add/update`, `k8s_apply_manifest` |
| `installer-agent` | `helm_upgrade`, `helm_repo_add/update` (its four k8s verbs *are* gated) |
| `frontend-agent` | `k8s_apply_manifest` |
| `snowplow-agent` | `k8s_apply_manifest` |
| `k8s-agent` | `k8s_label/remove_label/annotate/remove_annotation` |

`helm_uninstall` deletes a release and everything in it with **no approval pause** — the
only uninstall-class verb in the tree that does not stop for a human. And `frontend-agent`'s
gap is a **template bug, not a decision**: its pin sets `requireApproval: []`, which is falsy
in Go templates, so the `with` block is skipped and no key reaches the CR at all. Someone
wrote that gate and it silently evaporated.

The orchestrator itself is clean — 8 read-only tools, and its prompt (*"You are read-only:
you hold no apply tool"*) is accurate. All mutation is by delegation.

> **Hotfix first.** Adding the missing `requireApproval` entries is a pin change, costs one
> click per action, breaks nothing, and does not wait on any UI being built. Do it
> immediately and independently of this programme. Branch `fix/gate-helm-agent-and-metadata-writes`
> (`krateo-agentiko/autopilot`) covers `helm-agent` and `k8s-agent`; the other three live in
> charts not yet patched.

---

## 1. Removal list

All in `.spec.declarative.tools[].mcpServer.toolNames` on Agent CRs in `krateo-system`,
sourced from charts in `krateo-agentiko` plus pins in the installer.

| Agent | Strip | Capability lost with no UI replacement |
|---|---|---|
| `helm-agent` | `helm_upgrade`, `helm_uninstall`, `helm_repo_add/update`, `k8s_apply_manifest` | *"fix this stuck release"* — no Helm release page exists; releases are reachable only via compositions |
| `installer-agent` | `helm_upgrade`, `helm_repo_add/update`, `k8s_apply_manifest`, `k8s_patch/label/annotate_resource` | **none — see B8.** Its writes targeted the Installer claim, which the umbrella re-renders, so they reverted. `helm_upgrade` and `helm_repo_add` are also **ungated** on the live CR (absent from its `requireApproval`): two more ungated write paths beyond the four already found |
| `k8s-agent` | `k8s_apply_manifest`, `k8s_create_resource(_from_url)`, `k8s_patch_resource`, `k8s_delete_resource`, `k8s_rollout`, `k8s_scale`, `k8s_execute_command`, the four metadata verbs | ad-hoc restart/scale/patch on **raw workloads** (the portal is composition-only); **`k8s_execute_command` has no possible UI equivalent** |
| `frontend-agent`, `snowplow-agent` | `k8s_apply_manifest` | server-side dry-run validation of authored widget / RESTAction CRs — drafts would publish unvalidated |
| `core-provider-agent`, `authn-agent` | `k8s_apply_manifest`, `k8s_patch_resource` | Krateo `User` provisioning (already UI-less) |
| `incident-agent`, `clickstack-agent` | ~~`run_query` (keep `run_select_query`)~~ — **CANCELLED, the item was backwards**; see below | — |

The `*-bench` tree is exempt; document it as such rather than silently skipping it.

> **Six ungated write paths now, not four.** The live `installer-agent` on krateo-057 gates
> only `k8s_patch/apply/label/annotate_resource`; its `helm_upgrade` and `helm_repo_add` sit
> in `toolNames` with no `requireApproval` entry — the same omission shape as `helm-agent`'s
> missing block. `hack/lint-agent-tool-gating.py` catches both by name, but **only for charts
> in the autopilot repo**: `installer-agent` ships from its own chart
> (`krateo-installer-agent`), which is not checked out here, so its fix and its lint coverage
> are still outstanding. The same applies to `frontend-agent`, `snowplow-agent`,
> `core-provider-agent`, `authn-agent`, `incident-agent` and `clickstack-agent`.

### The one that cannot be translated — DECIDED: remove it

**`k8s_execute_command` is a `kubectl exec`.** It mutates whatever the target container can
reach — a filesystem, a database, a config file — **without touching the Kubernetes API at
all**, so no GVK- or RBAC-shaped control describes its blast radius, and no widget can
represent it.

> **Owner decision, 2026-09-15: remove it.** Not as a consequence of the sweep but on its own
> merits — a tool whose blast radius cannot be described cannot be gated, and leaving it in
> would put a hole in the middle of a programme whose entire premise is that every action is
> expressible, reviewable and bounded. An exception here would be the one that swallows the
> rule.

This is a **capability loss, not a translation**, and it should be planned for rather than
discovered:

- **In-container diagnosis goes away permanently.** No reading a config file inside a running
  pod, no checking what a process actually sees, no querying a database through its own client.
- **RCA evidence gets thinner.** Incident triage currently reaches inside containers; afterwards
  it sees the cluster's own telemetry — logs, events, metrics, CR status — and nothing past the
  container boundary.
- **The replacement is observability, not a widget.** If a class of incident needs in-container
  facts, the answer is to export those facts (a log line, a metric, a status field) so they are
  visible without an exec. That is work for the components, not for the portal.
- **Humans keep the capability.** `kubectl exec` is unchanged for an operator with the rights.
  What goes is the *agent's* ability to do it unattended.

---

## 2. Build list

Ordered so that nothing is removed before its replacement exists.

| # | Build | Unblocks |
|---|---|---|
| **B0** | ~~Thread `origin` through `Form.tsx:403`; extend `stampAgentCreated` to PUT/PATCH~~ — **corrected, see below**; the real content folds into B1 | — |
| **B1** | ~~`submitForm` verb~~ **cancelled by owner decision (§3)** — the agent never submits. Its four surviving gates **shipped**: mounted-control only, visible-fields only, confirm denies on silence, drafted-field summary | the whole model |
| **B2** | Validation-without-apply: a chart-gate / `validate_manifest` **read** tool for widget and RESTAction CRs. **Blocked here** — the MCP server chart is not checked out. Note the never-submit decision *reduces* its urgency: the agent no longer writes, so the apiserver validates at the human's submit. It remains worth building to avoid wasting that human's time on an invalid draft | `frontend-agent`, `snowplow-agent` removal |
| **B3** | Render-preview widget kind (helm-render `/diff`-style RESTAction + sandbox render) — also replaces the rail-only preview gate. **Not started**; B4 and B5 shipped without it, so it is no longer a blocker, only an improvement | B4 |
| **B4** | **Blueprint authoring + publish UI — the largest item.** Needs a repeatable-row / multi-file control; `SchemaFields` has no `Form.List`, so this is a **new widget kind** → the 4-piece release (frontend image + portal template + CRD + installer pin). The publish half reuses the existing `BuilderPublish` claim | closes the one real A1 gap |
| **B5** | Widget-CR authoring form — **shipped**. Publishes one widget CR through the existing `BuilderPublish` claim; `widgetData` is a JSON-object field emitted one top-level key per line | agent page authoring |
| **B6** | Workloads day-2 pages: scale / rollout restart / delete, per namespace | `k8s-agent` removal |
| **B7** | ~~Helm releases page: list, values diff, upgrade, rollback, uninstall~~ — **cancelled, see below**; the read half folds into B8 | `helm-agent` removal |
| **B8** | Platform component versions — **read-only, shipped**; the pin-change form was specified but is the wrong instrument, see below | `installer-agent` removal |
| **B9** | Scoped resource forms — **done**: Krateo `User` **built**; `CompositionDefinition` register **already existed**; kubeconfig `Secret` **declined on an existing design decision**, see below | `core-provider-agent`, `authn-agent` |

> **The `run_query` removal was the one item called a "free win". It would have broken telemetry
> RCA. Verified 2026-09-16.**
>
> The premise was that `run_query` is unrestricted SQL and `run_select_query` its safe sibling.
> Both halves are wrong:
>
> - **They are the same tool, renamed.** mcp-clickhouse ≤0.4 served `run_select_query`; **0.5.0
>   serves `run_query`**. The charts list both only because kagent keeps the names the server
>   actually serves. krateo-057 runs 0.5.0, pinned by digest — so **`run_select_query` does not
>   exist there**. "Strip `run_query`, keep `run_select_query`" would have left both agents with
>   *no query tool at all*.
> - **It is not unrestricted.** Upstream 0.5.0 `run_query` calls `build_query_settings()`, which
>   sends `readonly=1` unless `CLICKHOUSE_ALLOW_WRITE_ACCESS=true`. The chart does not expose that
>   variable and the live Deployment does not set it. There is no ungated `DROP`/`TRUNCATE`.
>
> The lint's `READ_EXCEPTIONS` comment asserted the same error in writing (*"run_query
> (unrestricted) is NOT exempt"*), which is how it would have survived review. Corrected there too.
>
> **Sweep result — eight ungated write paths, not four.** Linting all of krateo-agentiko found:
> `installer-agent` `helm_upgrade` + `helm_repo_add` + `helm_repo_update`; `frontend-agent` and
> `snowplow-agent` `k8s_apply_manifest`; and three codegen agents (**parked**, see below) holding
> `create_or_update_file` **and `push_files`** against GitHub. The lint had never seen any of them — it globbed only
> `chart/templates/*.yaml`, so it covered the autopilot chart and nothing else. It now globs all
> three fleet layouts and takes explicit roots: **45 templates clean**.
>
> **Every mutating Kubernetes and Helm tool is now gone from all six specialist agents.**
>
> **The codegen agents are PARKED — owner decision, 2026-09-16.** They are not deployed on
> krateo-057 (no `Agent` CR) and are **not among the installer's 46 components**, so they are not
> part of this platform today and gating a chart nobody runs buys nothing. The gating commit
> exists on a local branch in `krateo-agentiko/codegen-agents` and is deliberately **not** being
> pushed or landed; the finding stands recorded here so it is not rediscovered.
>
> If they are ever adopted, two things come with them: `create_or_update_file` and `push_files`
> commit **straight to a repository**, bypassing the change-request path the rest of the platform
> publishes through, and the only restraint today is a sentence in each prompt. Gating them is the
> floor; the real question is whether a codegen agent should write to git at all rather than open
> a change request like every other publish path. **That question is deferred, not answered.**
>
> **Consequence — `hitlApproval` is now a dead knob (owner's observation, confirmed).** Grep finds
> **zero template references** to it anywhere in the fleet: with no mutating tool left, there is
> nothing for an approval flag to gate. It is marked deprecated/inert rather than deleted, because
> the installer injects the key into every agent component (`compositions.yaml`, `set $spec
> "hitlApproval"`) and the agent schemas are `additionalProperties: false` — deleting the property
> would make the installer's own render fail validation. **Retiring it is a coordinated installer +
> chart change**, and it is the correct end state: the approval gate migrates from the agent's
> tools to the human pressing the portal control.


> **B9 resolved three ways, only one of which was a build. Verified 2026-09-15.**
>
> - **Krateo `User` — was a real gap, now built.** Settings → Users listed accounts but could
>   not create one, so provisioning was a kubectl step. Now a form creating the
>   `kubernetes.io/basic-auth` Secret and the `User` CR as one gated set, Secret first.
>   **The group field is an enum, and that is the substance of the change:**
>   `ClusterRoleBinding/cluster-admin-binding-krateo-system` binds `Group/admins` — its only
>   subject — to `ClusterRole/cluster-admin`, so an account built by copying the existing
>   `admin` User's shape silently becomes a cluster administrator. Free text would put that a
>   typo away. Confirmed by server dry-run that `groups: null` is *pruned*, so the default
>   choice stores no `groups` key at all — exactly the least-privilege shape.
> - **`CompositionDefinition` register — already exists.** `form.blueprint-install` POSTs a
>   `CompositionDefinition` with a CRD-driven schema; that *is* the register flow, reached from
>   a marketplace tile's Install. Nothing to build.
> - **Kubeconfig `Secret` — declined, and the plan was wrong to ask for it.**
>   `form.register-cluster` documents the opposite decision in its own header: *"we
>   register-by-Secret-ref and never accept raw kubeconfig text in the browser (the credential
>   should be ESO-synced; the ops step of creating that Secret is out of band)"* (§2.1).
>   Building the form would reverse a deliberate security decision and route a cluster-admin
>   credential through a browser field into the portal's audit trail. **The absence is the
>   feature.** If it is ever revisited, that is a change to §2.1 made on its own merits — not a
>   line item absorbed into a parity sweep.


> **B7 and B8 were both specified as write surfaces. Measuring the cluster says otherwise.**
> **Verified on krateo-057, 2026-09-15.**
>
> **B7 — a Helm releases page should not exist.** The cluster has 151 release-secret
> revisions across **49 distinct releases**. 42 of them are CompositionDefinitions, which the
> **Compositions page already lists**; most of the remaining 8 are composition *instances*
> (`publish-sock-shop-vv2bvc2b`, `github-provider-kog-49vwdvz7` — the suffix is a composition
> id) or bench artifacts. What is genuinely free-standing — `cert-manager`,
> `installer-platform` — are entries in the **Installer CR**, which manages 46 components. So
> a releases page would duplicate `/compositions` for most rows and the Installer for the
> rest. In Krateo every composition *is* a Helm release; a page organised by release rather
> than by composition cuts the platform along a seam it does not have. **Cancelled**; its
> useful half — *what is installed at what version* — is what B8 now ships.
>
> **B8 — the pin-change form is the wrong instrument, and the read half is the valuable
> half.** Three findings, each checked rather than assumed:
>
> 1. **A pin patch to the Installer claim is not durable.** The umbrella re-renders the CR, so
>    the change silently reverts (this was the `installer-outer-release-reset` root cause). The
>    durable pin lives in the installer chart's `component-pins.yaml` and moves by change
>    request + release — a documented ~20-step runbook with an OCI-publication precondition, a
>    forward-only rule, and a known cascade race. **That is a release process, not a form**, and
>    rendering it as a button would misrepresent it.
> 2. **`spec.components` is an atomic array.** No `x-kubernetes-list-type`, no merge key — so a
>    merge-patch *or* a server-side apply replaces all 46 entries wholesale, silently dropping
>    the 25 other per-item fields (`deps`, `gatewayPath`, `gatewayAuth`, …). The only safe
>    instrument is an RFC-6902 JSON-Patch with a `test` guard. snowplow *would* carry it
>    (`/call` echoes the caller's `Content-Type` straight through), but `buildPayload`
>    always produces an object, so no existing Form can emit one.
> 3. **`component-pins.yaml` is hand-curated**, carrying per-pin rationale comments. Generating
>    it from the live claim — the one route that needs no repo read — would destroy that.
>
> **Shipped instead:** a read-only *Declared versions* table under Observability → Components,
> beside the existing runtime table. One answers "what is running", the other "what does the
> platform declare"; the gap between them is precisely the signature of a **stalled component
> migration**, which has cost real debugging time and was invisible from the portal.
>
> **This does not weaken the removal.** `installer-agent`'s `helm_upgrade` and
> `k8s_patch_resource` were, per (1), producing changes that revert — removing them removes a
> footgun, not a capability. Both were also **ungated**: neither appears in that agent's
> `requireApproval`, a fifth and sixth ungated write path beyond the four already found.

> **B0 was based on two claims that do not hold. Verified 2026-09-15 by reading the code.**
>
> 1. *"Until B0, every agent write records `actor:'human'` — an affirmative lie in the audit
>    trail."* **False today.** `prefillForm` only FILLS a mounted form; it never submits. The
>    agent's write path is `runAction` (`actionBridge.ts:432`), which DOES thread `origin`.
>    `Form.tsx:403` passing `undefined` is a HUMAN pressing submit, and recording
>    `actor:'human'` for that is correct. The lie would begin the moment `submitForm` lands —
>    so threading origin is a **precondition of B1**, not a standalone fix, and belongs inside
>    it where it has a consumer.
> 2. *"Extend `stampAgentCreated` to PUT/PATCH via annotation."* **Contradicts a documented
>    decision and duplicates an existing record.** `recordProvenance` is not verb-gated: it
>    stamps the real verb and the real actor for every write, so agent edits are already
>    audited. `stampAgentCreated`'s docstring reasons explicitly that a `created-by` label on
>    an edit would claim the agent created an object a human may have made, and that the edit
>    belongs in the AuditRecord — which is where it already is.
>
> Net effect: the programme starts at **B1**, and the first genuinely-useful work is track C's
> guardrail (below), which is independent and prevents the class of regression that produced
> the ungated agents in the first place.

**Already built, contrary to earlier belief** — verified in deployed chart `1.8.23`:
`/portal-builder` mounts a **Compose-a-page** form with a **Publish page** button and a full
target section (org, repository, base branch, branch); `/controller-builder` mounts paste-OAS
and define-controller cards. Only `/blueprint-builder` has no authoring control.

---

## 3. The submit problem

> ## ⚠ Superseded by owner decision, 2026-09-15: **the agent must never submit anything.**
>
> Everything in this section below the line was written for a `submitForm` verb. **That verb is
> cancelled.** The parity model is now:
>
> **The agent opens the right widget and fills it. A human presses the button.**
>
> This is a *stronger* guarantee than the five gates below, and it is simpler: there is no
> allowlist to maintain, no opt-in label to audit, no question of which forms are submittable,
> and the residual risk recorded further down — a mistaken model submitting a DELETE-verb form
> one confirm away from irreversible — **does not exist**, because no agent-originated submit
> reaches the dispatcher at all.
>
> **What shipped instead** (branch `fix/b1-agent-write-surface-gates`, 24 tests green):
>
> | Was going to be | Shipped as |
> |---|---|
> | 1. Opt-in `krateo.io/agent-submittable` label + CI lint | **dropped as moot** — `mayAgentDispatch` refuses every submit action unconditionally (`actionBridge.ts:86`, called at `:152`). An allowlist for something that never happens is dead configuration. The lint survives as a *surface enumerator*, not a gate |
> | 2. Refuse submit unless the form is actively mounted | **shipped** — `getQueriesData({type:'active'})`; the agent may only drive a mounted control |
> | 3. Refuse if the draft set a `propertiesToHide` key | **shipped** — `narrowAgentDraft` filters to fields that are both real *and* visible |
> | 4. `APPROVAL_TIMEOUT_MS` on the confirm modal | **shipped** — `confirmWithTimeout`, 5 min, **denies on silence** rather than hanging open |
> | 5. Field-level "the agent set these N fields" summary | **shipped** — `ReviewSummary` tags Autopilot-drafted fields in the review step |
>
> Gates 2–5 are **not** redundant under a never-submit rule. They bound what the agent may
> *author and stage* for a human — which control it may drive, which fields it may fill, and
> what the human sees before pressing the button. Gate 4 in particular now protects a human
> decision rather than an agent one.
>
> **The one thing the decision costs:** an agent cannot complete a task end-to-end. Every write
> ends with "…now press Publish". That is the intended shape — it is what "every action goes
> through the UI" means — but it should be owned, not discovered when a demo stops halfway.
>
> **Confirm fatigue is reduced, not solved.** The volume of dialogs drops sharply, because the
> agent no longer generates approval requests; a human pressing a button is already an
> intentional act. What remains is the ordinary risk that a person clicks through their own
> confirms.
>
> *The original analysis is kept below because its inventory of what each gate protects, and its
> reasoning about the confirm being sole and load-bearing, is what made the never-submit decision
> the obvious call.*

---

### Original analysis (superseded)


`prefillForm` already authors form bodies. `runAction` already reaches a Form's submit action
(with the *ref's* payload, not the user's). **Submit closes the loop** — and when it does,
this must be said plainly:

> **The blast-radius confirm becomes the only remaining control.**

Today's guarantees and their fate:

| Guarantee | Survives? |
|---|---|
| Blast-radius confirm modal | **yes** — the chokepoint at `useHandleActions.ts:352` tests the *verb* and is blind to the caller |
| *"Autopilot never submits"* | ~~**no** — deleted by definition~~ → **yes, and now enforced.** It was already untrue before this programme (`runAction` could reach a submit action with the ref's payload); `mayAgentDispatch` makes it true |
| `isApplySetAllowed` kernel | **no** — it guards the compile path, which goes away |
| Preview / blueprint gates | **no** — rail-scoped, and the rail stops being the write path |
| Provenance stamping | **not today** — `Form.tsx` passes `origin: undefined` (see B0) |

**Hard implementation constraint:** `submitForm` must drive the Form's existing
`onSubmit → handleAction → runRest` path. **Never** a new `fetch`, never `runRestSet`, never
`skipConfirmForSandbox`. Route around that chokepoint and the last gate is gone.

### Five additions, all required before any removal

1. **Opt-in label** `krateo.io/agent-submittable: "true"` on the widget CR — restores an
   enumerable, default-closed write surface in place of `isApplySetAllowed`. Enforce with a CI
   lint over `portal-kpo`.
2. **Refuse submit unless the form is actively mounted** — fix `lookupAction` to use
   `type: 'active'`; it reads the 5-minute gc cache today.
3. **Refuse if the draft set any key in `propertiesToHide`** — no hidden-field authorship.
4. **Port `APPROVAL_TIMEOUT_MS` (5 min) onto the confirm modal** — otherwise this trades an
   active deny for a dialog left open indefinitely.
5. **Field-level "the agent set these N fields" summary** above the YAML — the agent now
   controls diff length inside a 560px modal.

### Residual risk — accepted, by decision

A mistaken model can still pick the wrong allowlisted form, author every schema-exposed field,
and submit a **DELETE-verb form** — one confirm away from irreversible. One action per reply,
unbounded per thread.

> **Owner decision, 2026-09-15: NO per-thread write budget.** The options considered were a hard
> cap (N approved writes, reset by a new thread), a rate limit, escalating friction after N, and
> a blast-radius-weighted budget. None is adopted.

What this means, stated so it is owned rather than discovered:

- **The blast-radius confirm is load-bearing and now sole.** Every other gate narrows *what* the
  agent may attempt — mounted controls, visible fields, allowlisted submits. Only the confirm
  decides *whether* a given write happens, and nothing bounds how many times it is asked.
- **Confirm fatigue is the live risk.** The failure is not one bad dialog; it is the twentieth,
  answered by reflex. Salami slicing — many individually-reasonable approvals adding to
  something nobody approved as a whole — is not addressed by any gate now in place.
- **A looping model can ask indefinitely.** Even when every answer is "no", the human's attention
  is the resource being consumed.

**What would reopen this.** Evidence that approvals are being rubber-stamped: confirms answered
faster than they can be read, or a thread with a long unbroken run of approvals. The AuditRecord
already carries what is needed to look — actor, verb, target and the originating prompt, per
write — so this is measurable rather than a matter of opinion. **Escalating friction (option C)**
is the cheapest thing to add if that evidence appears: it targets fatigue directly, needs no cost
model, and does not stop legitimate work.

~~`submitForm` is unblocked by this decision. It ships on the five gates and the confirm alone.~~
**Overtaken:** the owner decision above cancels the verb outright, which removes this entire
residual-risk class rather than accepting it.

---

## 4. Sequencing

Three tracks run in parallel:

- **A — frontend:** B0 → B1
- **B — portal-kpo:** B3 → B4 / B5 / B6 / B7 / B8 / B9
- **C — charts:** fix the `with []` falsy-template bug; add a lint asserting no agent's
  `toolNames` contains a mutator

Serial constraints: **B0 before B1. B3 before B4. B1 + B2 before any removal.**

Removals ship one per release, easiest first:
`run_query` → frontend/snowplow `apply` → core-provider/authn → `installer-agent` →
`helm-agent` → **`k8s-agent` last**.

Every new portal form crosses repos: portal template **plus** frontend-crds **plus** installer
pin. A CRD roll without the matching image blanks pages.

---

## 5. Honest size

**Weeks, not days.**

`B0` ~~1–2d~~ **cancelled** · `B1` 1w · `B2` 1w · `B3` 1w · **`B4` 3–4w — shipped in 1d**, the
estimate was inherited from a subagent and wrong (`filesBundle` as a map needs no new widget
kind) · `B5` 2–3w · `B6` ~~2–3w~~ **shipped** · `B7` ~~2w~~ **cancelled** · `B8` ~~1w~~ **shipped
read-only** · `B9` 1w · removal + verification on krateo-057 1–2w.

Four of the nine items did not survive contact with the cluster: **B0** rested on two claims the
code contradicts, **B4** was over-estimated by ~20×, and **B7/B8** were specified as write
surfaces that measurement showed to be redundant or non-durable. That is the expected yield of
checking a plan against reality rather than executing it — and it is why the remaining estimates
should be treated as untested.

**≈16 weeks serial, ≈10–12 parallelised across the three tracks.**

---

## 6. Risks the decision did not ask about

- **Until B0, every agent write records `actor: 'human'`.** That is an affirmative lie in the
  audit trail, produced silently. It is the first thing to fix and the cheapest.
- **`TOKEN_PASSTHROUGH` means the blast radius is still the chatting user.** For a Krateo
  admin (`Group/admins` ⇒ cluster-admin), parity **moves** exposure from the agent's service
  account to the user's session. It does not reduce it.
- **`core-provider-chart-gate-mcp-server`'s ServiceAccount holds `create` on `*/*`
  cluster-wide**, with its dry-run unverified. That is a bigger hole than everything being
  removed here. Audit it inside this programme.
- **Confirm fatigue.** Every action becomes a modal, users learn to click through, and the
  modal is now the *sole* gate. Mitigate with the field-level summary and the write budget.
- **The agent's reach grows with the portal charts forever.** Hence the opt-in
  `agent-submittable` label rather than an implicit allow.
- **MTTR rises during the gap.** The agent becomes an advisor for incidents until B6/B7 land.
- **MTTR does not fully recover afterwards, for exec-shaped incidents.** With
  `k8s_execute_command` gone by decision, a class of investigation that used to be one agent
  step becomes a human with a terminal. Budget for closing that with telemetry — exported
  facts rather than a restored tool — and expect it to surface as "the agent used to be able
  to tell me this".
- **`allowedResources` enforces nothing** (`Flex.crd.yaml:166-170`). Do not assume the CRD
  blocks a mount.

---

## 7. Relationship to A1

A1 currently records: *"breached — on both halves"*, with the closure gate *"can a user who
never opens the rail author and publish a page?"*

That gate is now **partly satisfied** — pages and controllers can be authored and published
from the UI in `1.8.23`; blueprints cannot. A1's note should be corrected to say so, and this
programme supersedes its second half: the rule asked that the agent *press the control*, and
the decision here is that the control is the agent's only option.
