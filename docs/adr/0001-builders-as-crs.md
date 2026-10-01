---
type: Decision
title: ADR 0001 — builders are declared as Builder CRs that name code plugins
description: Why a builder (Portal, Blueprint, Controller) is a Builder custom resource referencing named plugins the frontend ships, what stays code, and how a plugin or a builder is promoted.
resource: builders.templates.krateo.io
tags: [adr, builders, crds, composer]
timestamp: 2026-09-30T00:00:00Z
---

# ADR 0001 — Builders as CRs

- **Status:** accepted (option b, Diego, 2026-09-30)
- **Issue:** krateo-platformops/frontend#407 (T1), parent #405, audit #404

## Context

Everything a user *views* in the portal is declarative: widget CRs and RESTActions. The
builders that *author* that content are not. `PageComposer` and `BlueprintComposer` are
~26k lines of hardcoded React and Autopilot logic, more than all 50 widget kinds together
(#404). A third builder, the Controller Builder, written the same way would add another
~8–10k lines.

The composers can't be widgets. They need drag-and-drop, a live graph, a multi-file draft
with undo, preview drawers and a multi-step publish, all sharing one editor state across
the palette, canvas and inspector. The widget model (a CR renders, an action fires) has no
place for that state (#404, rejected option 3).

Most of what distinguishes one builder from another is still configuration:

- its route and label;
- its start form;
- which RESTActions it lists from and previews through;
- which files a draft must keep, and which the portal writes;
- which lints and gates apply;
- where it publishes, and which Autopilot verbs it accepts.

Today each of these is a constant scattered across `RoutesContext.tsx`, `publishDraft.ts`,
`builderTargets.ts`, `chartVerbs.ts` and the two composers.

## Decision

**A builder is a `Builder` custom resource.** It declares everything that is configuration.
Everything that is behaviour, it **names**: plugins the frontend ships, looked up in a registry.

- **CRD:** `builders.builders.templates.krateo.io`, kind `Builder`, `v1alpha1`, namespaced.
  It ships in the `frontend-crds` chart at `helm/frontend-crds/templates/builders/Builder.yaml`.
- **Registry:** `ui/src/builders/pluginRegistry.ts` maps name → implementation for five slots:
  `palette`, `canvas`, `inspector`, `parser` and `summarizer`. It also holds the lint and gate
  names.
- **Parser:** `ui/src/builders/builderSpec.ts` is the typed mirror of the CRD. It turns
  whatever the cluster returns into a `Builder` or a list of sentences, and never throws.
- **Descriptors:** `ui/src/builders/fixtures/{portal,blueprint,controller}-builder.builder.yaml`
  describe today's three builders. The portal chart ships them as CRs in `BUILDERS_NAMESPACE`
  (krateo-system), copied byte-identical (a test pins each file's sha256). The frontend reads the
  CRs from the cluster (`ui/src/builders/clusterBuilders.ts`) into the one seam
  `ui/src/builders/builderRegistry.ts`; the fixtures are test data and never bundled.

### Why its own group, next to the widgets

The CRD sits in the chart that owns the widget CRDs, so it versions in lockstep with the
frontend that ships the plugins it names. One tag publishes both, and the installer pins both
at one version. A Builder naming a plugin its frontend lacks is a skew that lockstep release
prevents.

It is **not** in `widgets.templates.krateo.io`, for two reasons:

- **snowplow dispatches `/call` by group.** That group is resolved as a widget
  (`widgetData`, `resourcesRefs`, `apiRef`). Any other group is a plain apiserver passthrough
  under the caller's identity, and that is what a Builder is: configuration the frontend reads
  as the person.
- **The Portal Builder's palette offers every CRD in the `widgets` category.** The Builder CRD
  declares `[krateo, builders]` so it can never be placed on a page.

The group `builders.templates.krateo.io` keeps it in the `templates.krateo.io` family beside
RESTActions and widgets.

### Why the file is where it is

Every `*.crd.yaml` directly under `helm/frontend-crds/templates/` is generated from a widget
schema, and three jobs rely on that exact glob:

- `crd-drift` fails a chart CRD the generator does not produce;
- the release-tag `crds` job deletes and re-copies them;
- `gen-widget-kinds` makes each one a placeable widget kind.

The Builder CRD is hand-written, so it lives in a subdirectory under a name none of those
globs match. Helm renders subdirectories of `templates/` like any other template.

### Schema rules

- **Strict.** No `x-kubernetes-preserve-unknown-fields` anywhere. Every object is fully typed
  and lists are `x-kubernetes-list-type: set` or `map`.
- **No `default:` on any key.** The installer applies chart defaults live, so a schema default
  would be a second, silent source of truth. Where a value varies it is required.
- **One cross-field rule, in CEL:** a `render` preview must name its RESTAction. The parser
  repeats the rule word for word.
- **Only install-config key names for destinations.** `publish.targetKey` and
  `publish.templateKey` name `config.api` keys, never an `owner/repo`. Destinations stay an
  install concern (`builderTargets.ts`).

### Why plugins are refused by name

Plugin lookup is deny-by-default: only an own key of the slot's table resolves. Prototype keys,
near matches and other slots' names don't. An unknown name comes back as a sentence naming the
slot and the name, never an exception, because a Builder is data from the cluster. A CR written
for a newer frontend is content to show where the plugin would have been, not a blank composer.
Lint and gate names follow the same rule: a check silently skipped would let through a draft its
builder meant to stop.

## What stays code

- **Plugins:** the palette, canvas, inspector, parser and summarizer implementations.
  - Registered today: palette `widgets`, `kinds` and `openapi`; canvas `page-grid`,
    `architecture-graph` and `restdef-graph`; inspector `object-tree`, `node` and
    `restdef-mapping`; summarizer `page-tree`, `chart-files` and `controller-model`. The three
    controller slot plugins shipped with the Controller Builder's composer (T8, frontend#412);
    `controller-model` with Autopilot's controller verbs (frontend#429).
- **Agent verbs:** a Builder's `verbs.allowed` names which verbs Autopilot may use on its drafts;
  what each verb does is code, routed through the same kernels a person's gestures use. The
  Blueprint Builder's chart verbs (`chartPut`, `chartDelete`, `chartLink`) and the Controller
  Builder's controller verbs (`controllerStart`, `controllerPlace`, `controllerMapVerb`,
  `controllerSetIdentifiers`, `controllerSetStatusFields`, `controllerRemoveKind`) are the two
  families. Both are draft-only and deny-by-default: a verb runs only if this frontend registers
  it and the held draft's Builder allows it.
  - No parser plugin yet: the Controller Builder reads its OpenAPI document with T7's kernel
    (`oasImport.ts`) inside its own start modal and workbench.
- **Lints and gates:**
  - Lints: `chart-lint` (`lintBlueprintDraft`), `gate-drift`, and `restdef-validate`
    (`lintControllerDraft`: the OpenAPI document reads, no verb conflict is unsettled, and T7's
    validator passes every RestDefinition).
  - Gates: `preview-before-publish` (the render-hash gate) and `publish-name`.
  - A Builder chooses which lints and gates apply. It cannot define new ones.
- **Start-value validation beyond `required` and `pattern`:** for example `chartNameProblem`
  and `publishNameProblem`. The start form is declared; what a value means stays the builder's
  code until the engine gives validators a slot.
- **The engine (T2):**
  - the draft store and draft records;
  - preview dispatch and the render-hash gate;
  - the BuilderPublish claim;
  - verb gating;
  - the composer host.

  These are one generic editor that every Builder configures.
- **Anything whose shape depends on a runtime value.** A page draft's root is
  `templates/flex.page-<slug>.yaml`, and the slug is only known once a draft starts, so
  `files.required` lists the fixed paths and the page code enforces the root.

## Promotion path

1. **A new builder that reuses registered plugins is YAML only.** Write a Builder CR, ship it
   in the portal chart, and the engine mounts it. No frontend release is needed.
2. **A new kind of canvas, inspector, palette, parser or summarizer is a plugin:**
   - write it as a component or function;
   - register it under a name in `pluginRegistry.ts`;
   - release the frontend.

   It is never a page or a route. Any Builder can use it from then on.
3. **A new lint or gate works the same way:** code plus a name in the registry's check table.
4. **A new spec field is a CRD change in this repository.** Edit the CRD, `builderSpec.ts` and
   its test (`builderSpec.test.ts` fails if the two disagree on keys or required keys), then
   release. Frontend and CRD move in one tag.
5. **Leaving `v1alpha1`:**
   - the Controller Builder runs on the engine from its CR (done, T8);
   - the Portal and Blueprint Builders (T13, T14) have migrated;
   - no field has changed meaning for one release.

   Then the version becomes `v1beta1`, matching the widgets.

## Consequences

- **Builder changes are reviewed as data.** A builder's route, RESTActions, verbs and
  destination keys show in a CR diff, not across five TypeScript files.
- **Two schemas to keep in step:** the CRD and `builderSpec.ts`. The test holds them together.
  The fixtures test also holds today's descriptors to the constants the composers still
  hardcode: the byte cap, the registration path, the config keys, the routes, the preview
  RESTAction and the verbs.
- **Reading Builders needs RBAC.** The engine lists Builders as the signed-in person, so the
  portal's authenticated-user role needs `get`/`list` on `builders.builders.templates.krateo.io`
  in `BUILDERS_NAMESPACE`. The read is snowplow `GET /list?category=builders&ns=<namespace>`:
  `/call` cannot list a collection (its GET needs a `name`), and `/list` lists every GVR in the
  category with the caller's own client, like the Portal Builder's widget picker.
- **The engine reads the cluster, with no fallback.** After sign-in the shell lists the Builders
  once per signed-in user (keyed on the username, so a token refresh does not read again), with a
  15 s timeout. Until the answer arrives, paths no route serves show a loading state; then each
  Builder is routed. The router is rebuilt only when the set of (name, route) changes, and a
  re-read's spec reaches each composer without a remount.
- **A failed read leaves no Builder running.** Snowplow down, a timeout, a 403, the CRD or its CRs
  missing: a builder's address (a hub prefix, or a route a Builder declared earlier in the tab)
  then says "Builders could not be read from the cluster: <reason>", and any other unknown address
  stays a plain 404. Every failure but a 403 is retried with a bounded backoff (and on the next
  mount, under the same cap). A re-read that fails while Builders are loaded keeps them and shows
  the error as a banner. A Builder that does not parse, or names a plugin this frontend lacks, is a
  problem sentence; the others still load. While the registry is loading or failed, the engine's
  deny sentences blame the read, not the Builders. Per-builder wording and naming that the CRD does
  not carry (a draft's display name, "a portal page") are draft-kind plugins keyed by
  `spec.draftKind` (`ui/src/builders/draftKinds.ts`).
- **Until T2, the CRD was inert.** It ships and validates, the descriptors parse and resolve,
  and nothing read them.
