# Krateo platform demo — five acts, ~22 minutes

Structured around **who does what**, not around features. Each act is one person's job;
the architecture is revealed inside the work rather than claimed up front.

Verified **2026-09-15** against `gke_operations-dev-krateo-io_europe-west3-a_krateo-057`
(portal at <https://portal.krateo.dev>), portal chart **1.8.23**, frontend **1.6.13**,
snowplow **1.12.6**. Where something was exercised end-to-end it says so; where it was only
read in code or on the cluster, it says that instead.

---

## The spine

> A platform team's job is **onboarding capability**. A developer's job is **consuming it**.
> A support engineer's job is **restoring it**. All three happen on the same objects, under
> the same permissions — and an agent participates in each as a colleague, not a side channel.

The line to land at the end:

> *Same doors, same locks, same log.*

---

## Cast and time

| Act | Persona | Job | Time |
|---|---|---|---|
| I | Developer | Get a database without filing a ticket | 3:00 |
| II | Platform engineer | Onboard a new blueprint | 6:00 |
| III | Platform engineer | Onboard a controller for an API Krateo has never seen | 4:00 |
| IV | Support engineer | Triage an incident at 2am | 5:00 |
| V | Anyone | Why any of this is trustworthy | 3:00 |

Cut Act III to 2:30 and Act V to 2:00 to land on 18 minutes.

---

## Setup (15 minutes before)

```sh
# kubectl that always carries kubeconfig + context. A zsh FUNCTION, not a variable —
# a variable containing spaces does not word-split in zsh.
k() { kubectl --kubeconfig ~/.kube/config \
        --context gke_operations-dev-krateo-io_europe-west3-a_krateo-057 "$@"; }

# Credentials (basic auth is the only strategy: GET /auth/strategies)
k get secret admin-password    -n krateo-system -o jsonpath='{.data.password}' | base64 -d
k get secret cyberjoker-password -n krateo-system -o jsonpath='{.data.password}' | base64 -d
#   admin      → group admins → cluster-admin
#   cyberjoker → group devs   → namespaced grants (Act V)

# Health gate — the only pods not Running should be Completed jobs
k get pods -n krateo-system --no-headers | grep -vE 'Running|Completed'

# Act II uses /s6-probe. Confirm it is free:
k get flex page-s6-probe -n krateo-system      # expect NotFound
```

**Warm up Autopilot.** An agent turn takes **~2 minutes** (measured). Open the rail and ask
anything — "what's on this page?" — so the first turn in front of the audience is not the
cold one. Leave the rail open.

**Two browser windows**, side by side: admin on the left, a private window for Act V.

---

## Dry run (do each once)

All four were exercised end-to-end on 2026-09-15:

- **Act II page publish** — `page-s6-probe` renders at `/s6-probe` after `kubectl apply`;
  snowplow resolves the Flex and both children get endpoints.
- **Act II live update** — patching the Paragraph changed the rendered page in **2 seconds
  with zero reloads** (navigation count unchanged). This is the best moment in the demo.
- **Act IV agent turn** — "How many compositions are failing right now?" returned a correct,
  grounded answer naming **publish-pet, installer, kagent**, with an evidence section, in
  ~2 minutes.
- **Act I/V pages** — Marketplace, Observability (Telemetry + Components tabs), Settings all
  return 200.

---

## Act I — The developer asks for something (3:00)

**Persona.** A developer who needs a database and has never read a Helm chart.

1. **Marketplace**. 293 blueprints + 86 operators, from the `blueprints-catalog-index`
   ConfigMap. Filter by tag.
2. Pick a blueprint → **Details** → **Install**.
3. The install form appears. **Say this**: *nobody wrote this form.* Its fields are generated
   from the blueprint's own `values.schema.json`, so it cannot drift from the chart.
4. Show the resulting composition in **Compositions**: status, and day-2 controls —
   Pause, Sync, Edit, Delete — each a real gated button.

**Do not submit** unless you want the composition afterwards. Opening the form is the point.

**What this proves.** Self-service without a ticket, and the form *is* the chart's schema.

**Fallback.** If the catalog is slow, open an existing composition's **Edit** drawer instead —
same generated-from-schema story.

---

## Act II — The platform team onboards a blueprint (6:00)

**Persona.** The platform engineer whose job is making Act I possible.

This act has two halves: the boring truth first, the agent second.

### II.a — A page is a CR (2:30)

```sh
k apply -f demo-page.yaml      # contents below
```

Then open <https://portal.krateo.dev/s6-probe>. The page is there: a paragraph and a button.
No build, no deploy, no restart. The route was already data — `menus/sidebar-nav` carries
`{ path: /s6-probe, page: s6-probe }`, and `page:` resolves `flexes/page-<slug>` at
navigation time.

**Then the moment the demo is built around.** With the page on screen, in a terminal they
can see:

```sh
k -n krateo-system patch paragraph demo-paragraph --type=merge \
  -p '{"spec":{"widgetData":{"text":"Changed at the apiserver. No reload."}}}'
```

The text changes **in about two seconds. Nobody touched the browser.** snowplow's informer
dirty-marks the widget and pushes an invalidation over the `/refreshes` SSE lane; the SPA
refetches just that widget.

> *"That is the same object I applied. The page is data, and the data is live."*

**Cleanup at the end:** `k delete -f demo-page.yaml`

<details>
<summary><code>demo-page.yaml</code></summary>

```yaml
kind: Flex
apiVersion: widgets.templates.krateo.io/v1beta1
metadata: { name: page-s6-probe, namespace: krateo-system }
spec:
  widgetData:
    allowedResources: [paragraphs, buttons]
    vertical: true
    gap: middle
    items:
      - resourceRefId: demo-paragraph
      - resourceRefId: demo-button
  resourcesRefs:
    items:
      - { id: demo-paragraph, apiVersion: widgets.templates.krateo.io/v1beta1, name: demo-paragraph, namespace: krateo-system, resource: paragraphs, verb: GET }
      - { id: demo-button,    apiVersion: widgets.templates.krateo.io/v1beta1, name: demo-button,    namespace: krateo-system, resource: buttons,    verb: GET }
---
kind: Paragraph
apiVersion: widgets.templates.krateo.io/v1beta1
metadata: { name: demo-paragraph, namespace: krateo-system }
spec:
  widgetData:
    text: "Hello from a server-driven page: everything you see here is a custom resource."
---
kind: Button
apiVersion: widgets.templates.krateo.io/v1beta1
metadata: { name: demo-button, namespace: krateo-system }
spec:
  widgetData: { label: Hello, icon: fa-sun, type: primary, clickActionId: none, actions: {} }
```
</details>

### II.b — Publishing it properly, by hand and by agent (3:30)

Hand-editing works but does not *stick*: the sidebar Menu is a child of the `Portal`
composition and the controller resyncs every 60 s
(`COMPOSITION_CONTROLLER_RESYNC_INTERVAL=60s`). **Optional 30-second twist**: `k edit menus
sidebar-nav`, add an item, reload — it appears; within a minute it is gone. *Managed content
is owned by the composition.* The sanctioned path is a change request.

**Show the human path first.** Go to **Portal Builder**. The **Compose a page** card is a
form that asks for: page slug, the widgets to place, **target org, target repository, base
branch, branch to commit onto**, and optionally a scaffold source. Its primary button reads
**Publish page**, and `reviewBeforeSubmit` shows the diff first.

> *"No AI involved. A person fills a form and it opens a change request."*

**Then the agent path.** In the rail: *"Add a page showing failing compositions."* Autopilot
drafts the widget CRs, previews them, and publishing opens a **pull request** — not a cluster
write. Show the real one: <https://github.com/krateo-blueprints/blueprints/pull/1> (open, 4
files, authored through the portal).

> *"The agent's output is a pull request. Your existing review process still applies."*

⚠️ **Do not author-and-publish a blueprint live.** The chain is not reliable enough yet: of
the two existing publishes, one produced a real PR whose `PullRequest` CR never recorded it
(`Ready=True`, empty `.status`, "API call not found for FindBy"). Narrate the flow and show
the finished PR.

**What this proves.** A page is a CR; routing is data; the composition owns what it rendered;
and publishing is a reviewed change request whether a human or an agent starts it.

---

## Act III — A controller for something Krateo has never seen (4:00)

**Persona.** The same platform engineer, facing an API with no Krateo support at all.

1. **Controller Builder**. Two cards, both UI-native: **paste an OpenAPI document** (stored as
   a ConfigMap you POST yourself), then **define the controller** from the operations parsed
   out of it.
2. The result is a `RestDefinition`. The registry table below shows READY state, the generated
   kind and apiVersion, and the OAS source — all derived server-side.
3. **Say what just happened**: new Kubernetes *kinds* now exist, reconciled by a generated
   controller. The thing you could not manage yesterday is a CR you can put in a blueprint.

> *"We did not write a controller. We described an API and got one."*

**What this proves.** The difference between *integrates with* and *extends to* — and the
authoring surface is widgets, not bespoke UI.

**Fallback.** If a live definition is slow, open the existing registry: 29 native GitHub kinds
from `github-provider-kog`, generated exactly this way.

---

## Act IV — Two in the morning (5:00)

**Persona.** The support engineer who built none of it.

1. **Alerts** — 9 rules live.
2. **Incidents** — open an existing **TroubleshootingReport**. It carries a verdict, the
   sources it consulted, the resources it examined, and a remediation plan. 6 reports exist,
   2 resolved.
3. **Say the important thing**: the agent did the first hour of the investigation before
   anyone woke up. It did **not** fix anything. Remediation is behind a human decision.
4. **Observability** → **Telemetry** (OTel → ClickHouse error digest, log stream) and
   **Components** (control-plane health drill-down).

> *"It doesn't fix things. It shows its work, and waits."*

⚠️ **Avoid the Reconciliation tab** — it queries `otel_traces` for
`composition-dynamic-controller` spans, and nothing on this install exports them, so it
renders empty. Also avoid the four **SP ·** tabs on this install: four widgets there return
400 and render error cards. *(Fixed in portal #210, merged; ships in chart 1.8.24.)*

**If you ask Autopilot live here, ask early and keep talking — a turn takes ~2 minutes.**

---

## Act V — Why you can trust it (3:00)

1. **RBAC.** In the private window, log in as `cyberjoker`. Walk the same pages. The widgets
   they may not see are **absent** — not greyed out, not padlocked, not erroring. A denial
   reads as absence, so the UI never leaks that a thing exists.
2. **Boundaries.** Autopilot's own prompt says *"You are read-only: you hold no apply tool"* —
   and that is **verified true of the orchestrator**: its entire tool surface is 8 read tools
   (`k8s_get_resources`, repo search/read, `validate_manifest`, `config_refs`). All mutation is
   reachable only by delegating to specialist agents. The widest of those, `k8s-agent`, has its
   seven direct-write verbs **and** `k8s_execute_command` behind `requireApproval`, which pauses
   the task and raises an approval card in the rail.
   Frontend write verbs go through the blast-radius modal, deny-by-default on silence.

   **Do not claim "every mutating tool is gated" — it is not true today.** An audit on
   2026-09-15 found ungated write verbs on `helm-agent` (including `helm_uninstall`),
   `snowplow-agent`, `frontend-agent` and `installer-agent`'s helm verbs. If asked how the
   agent is constrained, answer at the level that IS true: the orchestrator holds no mutating
   tool, the broadest specialist is approval-gated, and portal writes are gated in the UI.
   Tightening the rest is in flight.
3. **Provenance.** `k get auditrecords -n krateo-system` — 113 records. Agent-originated
   writes carry the prompt that caused them.

> *"Same doors, same locks, same log."*

---

## Answering the parity question honestly

Someone will ask: *can I do everything the agent can, without the agent?*

**Nearly, and the gap is one page.** Verified in the deployed chart:

| Surface | UI-native path |
|---|---|
| Compositions, blueprints, marketplace, alerts, incidents, clusters | **yes** — gated buttons and forms |
| Portal Builder (pages) | **yes** — Compose-a-page form → *Publish page* |
| Controller Builder (APIs) | **yes** — paste OAS + define controller cards |
| **Blueprint Builder (charts)** | **no**, in the deployed chart — header, Ask-Autopilot CTA, read-only table only; the composer below is built, not yet released |

**What is built but not yet deployed** (frontend source, no tag carries it yet): the Blueprint
composer at `/blueprint-builder/compose`. A person can start a chart (the generated Kind and API
version shown as the name is typed), see its architecture file drawn as a dependency graph, step
the states that graph derives, inspect each resource read-only, preview it (the lint, then the real
helm render), and publish it through the same destination form and confirm the agent's publish
uses. What it cannot do yet is place resources or draw edges by hand: a resource is added by
editing `templates/architecture.yaml` in Chart files, or by asking Autopilot. The palette, in-place
node editing and generated `lookup` gates are the next stage, and the `/blueprint-builder` entry
link ships with the portal chart after a frontend tag carries the route.

So: *"Pages and controllers you can author and publish by hand today. Blueprint authoring is
still agent-first in the deployed portal; the composer that closes it is built and on its way,
and adding resources to it by hand comes next."* That is true, checkable, and much better
than claiming total parity.

---

## Deliberately not included

- **Authoring + publishing a blueprint live** — the PR chain has a known defect (a publish can
  report success with an empty `PullRequest` status).
- **Observability → Reconciliation tab** — no reconcile telemetry is exported on this install.
- **The four SP tabs** — error cards until 1.8.24 is deployed.
- **`/clusters`** — no `KubernetesTarget`s exist; it is an honest empty state, but an empty
  state is a poor demo beat.
- **Incident "Review & apply"** — the remediation loop is provenance-gated and was not
  exercised end-to-end.
- **Voice input** — shipped but inert unless the transcribe URL is configured.

---

## Rough edges to know before you are asked

- **Agent latency ~2 minutes per turn.** Warm it up; narrate over it.
- **Only 3 non-platform compositions exist.** The default "My workloads" scope shows 3 rows;
  switch scope to "Platform" to see ~38. `sock-shop` and `demo-system` are empty namespaces.
- **Hand-edits to managed content revert in ~60 s.** This is a feature — but say it before
  someone notices it.
- **`publish-pet`, `installer`, `kagent` are genuinely failing** and will show in the
  reconciliation rail. Better to name them as real cluster state than to have them spotted.
