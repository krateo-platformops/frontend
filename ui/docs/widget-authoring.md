---
type: Architecture
title: frontend — widget authoring pipeline
description: How an Ant Design component becomes a Krateo widget — the schema.json → types/CRD pipeline, auto-registration, scaffolding, antd-fidelity conventions and verification gates.
resource: widgets.templates.krateo.io
tags: [widgets, authoring, antd]
timestamp: 2026-08-07T00:00:00Z
---

# Widget Authoring Pipeline

How an Ant Design component becomes a Krateo frontend widget, and how to add new
widgets — by hand, with the scaffolder, or in bulk from the antd catalog.

## The contract

A widget lives in `src/widgets/<Kind>/` and is discovered automatically. The
**source of truth** is `<Kind>.schema.json`; everything else derives from it.

```
<Kind>.schema.json   ──generate-types──▶  <Kind>.type.d.ts   (TS types)
                     ──generate-crds───▶  <Kind>.crd.yaml    (cluster CRD, gitignored)
<Kind>.tsx           the React component: maps widgetData → an antd component
index.ts             export default defineWidget({ kind, component, paginated? })
```

`index.ts` default-exports a `WidgetModule` (`src/widgets/widget-module.ts`). At
runtime `src/widgets/load.ts` discovers every `src/widgets/*/index.ts` via
`import.meta.glob` and registers it in the `kind → module` map
(`src/widgets/registry.ts`); `WidgetRenderer` looks the widget up by `kind`.
**There is no central switch to edit — adding a folder is enough.**
(`Drawer`/`Modal` keep a component-only `index.ts` and are mounted directly by
the Shell, so they are filtered out of the registry.)

## Server-driven constraints

The backend (snowplow) resolves a `Widget` CR and the frontend renders its
`status.widgetData`. Therefore:

- **widgetData must be JSON-serializable** — no functions/ReactNodes in the CR.
- **Events go through `WidgetActions`** (`rest` / `navigate` / `openDrawer` /
  `openModal`) via `useHandleAction`, never arbitrary callbacks.
- **Children come from `resourcesRefs`** (child widget endpoints resolved with
  `getEndpointUrl` → nested `WidgetRenderer`) or from a plain text field — not
  React `children`.
- If a schema declares `spec.actions`, it must include **all four** action types
  (enforced by `npm run validate-schemas`).

## Ant Design fidelity (the naming + property-schema convention)

Widgets respect Ant Design **as much as possible** — both the kind name and the `widgetData` property schema:

- **Kind name.** A widget that 1:1-wraps a single antd component takes that component's exact name as its `kind` (`Card`←Panel, `Col`←Column, `Tabs`←TabList, `Menu`←NavMenu). Composites, distinct concepts, and non-antd widgets keep a descriptive name (`Filters`, `BarChart`, `ButtonGroup`, `PieChart`, `FlowChart`).
- **Property schema.** `widgetData` copies antd's prop **names, enums and value shapes verbatim** for every serializable prop. Example — `List` mirrors antd `List`: `grid` is antd's `ListGridType` (`{ gutter, column, xs…xxl }`), plus `itemLayout`, `size`, `bordered`, `split`, `loading`, `dataSource`.
- **Necessary divergences** (a CR can't carry functions or ReactNodes), each with a serializable substitute:
  - `renderItem` (function) → an `itemTemplate` (field→slot mapping), or a child widget when a `dataSource` element carries a `resourceRefId`.
  - `header`/`footer` (ReactNode) → `string`.
  - event handlers (`onClick`, …) → a `WidgetActions` id.
  - `pagination` (antd page-based) → Krateo's cumulative-slice `ScrollPagination` (the registry `paginated` flag).
- **Krateo-only props are additive**: `sseEndpoint`/`sseTopic`, filter `prefix`, `maxItems`.
- **Renames are a hard-break (no aliases):** each widget resolves only by its antd `kind`; legacy kinds/props were removed. Existing cluster CRs migrate via [`cr-migration-map.json`](./cr-migration-map.json) (e.g. `Panel`→`Card`, `DataGrid`→`Listy`, `Table.data`→`dataSource`, `Button.backgroundColor`→`color`), applied in lockstep with the deploy. One irregular kind: the list widget is **`Listy`**, not `List` — Kubernetes reserves the `List` kind, so `kind: List` CRs cannot be created (`src/widgets/List/index.ts`).

### Non-antd dependencies (documented exceptions)

A few widgets reach outside antd because antd has **no core or ecosystem equivalent**. These are deliberate, isolated exceptions — new ones need the same explicit justification before they land:

| Widget | Library | Why |
|--------|---------|-----|
| `Markdown` | `react-markdown` | antd has no markdown renderer (core or ecosystem); the copy/download toolbar is antd `Button`. |
| `YamlViewer` | `react-syntax-highlighter` | antd has no code/syntax-highlight component; the empty/error/copy chrome is antd `Empty`/`Result`/`Button`. |

`FlowChart` is **not** an exception — it renders on the antd-ecosystem `@ant-design/graphs` (G6) with antd nodes via `@antv/g6-extension-react`.

## Prop classification

When mapping an antd component, sort each prop into one of:

| Target          | Goes to            | Example                              |
|-----------------|--------------------|--------------------------------------|
| `widgetData`    | serializable props | `Tag.color`, `Statistic.value`       |
| `action`        | a `WidgetActions` id | `Button.clickActionId`             |
| `resourcesRefs` | child widget refs  | `Panel.items[].resourceRefId`        |

## Three ways to add a widget

### 1. By hand
Create the four files following an existing widget (`Paragraph` = simple leaf,
`Button` = action, `Panel` = container). Then `npm run generate-types`.

### 2. Scaffolder (interactive)
```
npm run scaffold-widget
```
Prompts for the kind, the antd component, and each `widgetData` prop (with prop
classification), then emits the schema, component, `index.ts`, and an example
fixture. Follow up with `npm run generate-types`.

### 3. antd catalog (bulk)
`scripts/antd-widget-catalog.ts` declaratively maps antd components to widgets;
`npm run gen-antd-widgets` emits all of them. It is **idempotent** — existing
folders are skipped (never overwrites hand-authored widgets); use `--force` to
regenerate. Then `npm run generate-types`.

A component qualifies for the catalog when its inputs are JSON-serializable
display props (each catalog prop name matches the antd prop 1:1, so the generated
component is a typed pass-through). **Out of scope** for the catalog generator —
handle these by hand instead:

- Imperative/portal APIs: `message`, `notification`, `Modal.method`.
- Already custom: `Form`, `Modal`, `Drawer`, `Tabs`.
- Event-driven / non-serializable / rich-children: `Upload` (hand-authored, see
  `src/widgets/Upload`), `Mentions`, `Transfer`, free-form `AutoComplete`,
  `Cascader`, and components whose content is arbitrary child widgets (a future
  `resourcesRefs`-aware generator).

## CRDs and the cluster (the only out-of-band step)

`npm run generate-crds` (run from `ui/`) builds and runs **this repo's own generator**,
`crdgen/` — a small Go module — and writes `scripts/generated-crds/<Kind>.crd.yaml`.
These are **build artifacts** (gitignored), not committed: the shipped copy is the
`frontend-crds` chart (`helm/frontend-crds/templates/`); see the root
[release runbook](../../docs/release.md) for how CI syncs them.

**Requirements: a Go toolchain only.** `go build` replaces the `curl … | bash` install
this used to need, so there is nothing to pin and nothing to be reachable.

> **It used to be `krateoctl gen-widget`**, a binary CI installed by piping a release
> script to bash, pinned by hand in three workflows. That put the definition of this
> repo's own CRDs in another repository on another release cadence. The widget schemas
> are here and the CRDs ship from here, so the generator is here too.
>
> **It does not reimplement CRD generation.** It calls
> `krateo-platformops/plumbing/crdgen`, the same library core-provider and
> oasgen-provider use, because that library validates its output through the
> apiserver's **own** `ValidateCustomResourceDefinition` before returning. A generator
> that cannot be refused by the apiserver cannot emit a CRD the apiserver would reject —
> and that failure is silent, because an invalid CRD is refused at apply time while the
> previous version keeps serving. See `crdgen/doc.go`.

A generated widget kind is inert until its CRD and an example CR are applied to a
cluster so snowplow can resolve it:

```
npm run generate-crds      # crdgen → scripts/generated-crds/*.crd.yaml
npm run apply-crds         # kubectl apply the CRDs
npm run apply-examples     # kubectl apply the example CRs
```

### What a schema change costs, end to end

A new widget field is **four pieces**, and shipping three of them leaves the field
pruned on write with nothing reporting an error:

1. the widget's `schema.json` (the source of truth)
2. the regenerated CRD in `helm/frontend-crds/templates/` (CI's `crd-drift` job fails
   the PR if the chart and the generator disagree)
3. `widgetKinds.generated.ts`, derived from the CRDs for the page builder
4. a release that publishes **both** the image and the `frontend-crds` chart — they are
   produced by two different workflows, so a green tag does not imply a published chart.
   Verify with `helm show chart oci://ghcr.io/krateo-platformops/charts/frontend-crds
   --version <tag>`.

**A `required`, `enum`, `type` or `format` change is a TIGHTENING** and can only reject
objects, never admit more. `crdgen`'s own test suite refuses a schema whose `required`
names a property its `properties` does not define — unsatisfiable, and legal OpenAPI, so
the apiserver's validator accepts it. Before tightening anything, survey the live CRs:
`frontend-crds` 1.8.20 shipped 44 unsatisfiable widget CRDs and no widget carrying a
`resourcesRefsTemplate` could be applied until 1.8.21.

## Verifying

```
npm run generate-types     # schema → types
npx tsc --noEmit           # real typecheck (vite build does NOT typecheck)
npm run lint && npm run lint:css
npm test                   # registry test: every example kind resolves
npm run validate-schemas
```
