---
type: Component
title: frontend — index
description: The map of the frontend doc bundle — the Krateo Composable Portal SPA, its two Helm charts and the 43 widget CRDs, plus the code-adjacent internals corpus under ui/docs/.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [portal, frontend, widgets]
timestamp: 2026-08-07T00:00:00Z
---

# frontend

frontend is the **Krateo Composable Portal**: a server-driven React SPA that renders no
hardcoded pages — the shell, navigation and every page are `Widget` custom resources,
resolved into JSON by snowplow and mapped to React components at runtime. This monorepo
carries the app (`ui/`), its Helm charts (`helm/frontend/`, `helm/frontend-crds/` — the
43 widget CRDs) and one version line: image and charts ship together from a single
plain-semver tag.

## The bundle (start here)

- [overview](./overview.md) — what it does and how it works: the server-driven model,
  the nginx runtime, its place between authn / snowplow / eventrouter / autopilot.
- [usage](./usage.md) — install via the Krateo installer pin or direct
  `helm install oci://…`; local render recipe; local development and the examples portal.
- [configuration](./configuration.md) — the whole config surface: chart values, the
  rendered `config.json` contract, nginx/port wiring, the preview sandbox.
- [api](./api.md) — the contract it exposes: the 43 widget CRDs and the widget spec
  model; what HTTP surface the container serves.
- [examples](./examples.md) — the runnable examples under `examples/`.
- [release](./release.md) — how a release ships (tag → image + both charts on GHCR) and
  the CRD-sync seam.
- [log](./log.md) — curated history.
- [adr/](./adr/0001-builders-as-crs.md) — architecture decisions; 0001 declares builders as
  `Builder` CRs that name code plugins.
- [llms.txt](./llms.txt) — the version-pinned agent index of this bundle.

## The deep corpus (code-adjacent, authoritative for internals)

The internals documentation lives next to the code under
[`ui/docs/`](../ui/docs/llms.txt) and stays there — it is versioned with the app and
traced to `file:line` at the tag that matches the running build:

- [architecture](../ui/docs/architecture.md) — how the SPA is built: widget registry,
  WidgetRenderer, data-fetch layer, Shell + routes-as-data. Read before touching
  internals.
- [behavior](../ui/docs/behavior.md) — runtime behavior and the upstream contracts
  (config.json, auth/tokens, bootstrap, actions, events, live refresh).
- [gotchas](../ui/docs/gotchas.md) — real runtime pitfalls, each grounded in the code.
- [widget-authoring](../ui/docs/widget-authoring.md) — how an antd component becomes a
  widget (schema → types → CRD; scaffolding; fidelity rules).
- [widgets-api-reference](../ui/docs/widgets-api-reference.md) — the generated
  per-widget reference (all 43 kinds).
- [the widget concept](../ui/docs/docs.md) — widgetData, widgetDataTemplate, actions,
  resourcesRefs and templates.
- [form-values](../ui/docs/form-values.md) — Form initialValues semantics;
  [restactions](../ui/docs/restactions.md) — pointer to snowplow's RESTAction docs.
- Worked guides: [simple-page](../ui/docs/guides/simple-page/simple-page.md),
  [action-button](../ui/docs/guides/action-button/action-button.md).
- Records: [antd-migration-plan](../ui/docs/antd-migration-plan.md) (executed decision,
  `status: diverged` — see its implemented-reality note),
  [autocomplete-and-dependencies](../ui/docs/autocomplete-and-dependencies.md)
  (removed-feature note),
  [cr-migration-map.json](../ui/docs/cr-migration-map.json) (the hard-break CR
  migration map).
