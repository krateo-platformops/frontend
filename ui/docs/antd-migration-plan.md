---
type: Decision
title: frontend — Ant Design fidelity migration plan (executed)
description: The decision record for the fidelity-first / hard-break antd migration — legacy alias/prop purge, FlowChart on @ant-design/graphs, non-antd exceptions, dark mode, antd 6.
resource: ghcr.io/krateo-platformops/frontend
tags: [decision, antd, migration, archive]
status: diverged
timestamp: 2026-08-07T00:00:00Z
---

# Complete Migration Plan — Ant Design Fidelity (fidelity-first / hard-break)

_Status: executed (Phases D, 0, A, C, B on `ux-modernization`; Phase E — antd 5→6 — on `antd6-upgrade`). Notable deltas from the proposal: **BlueprintBuilder was dropped** (untested drag&drop composer), which let Phase A remove **reactflow entirely** rather than add a second graph engine; and **FlowChart's schema was left unchanged** (its `data` is a domain resource model, not a lib shape), so it needed no CR migration. Derived from the full audit (2026-06-15) of all 46 widgets + 11 components._

> **Implemented reality (re-verified 2026-08-07, current tree):** the plan is executed —
> `antd` is at 6.x, `reactflow` and `@dagrejs/dagre` are gone from `package.json`,
> `FlowChart` renders on `@ant-design/graphs`, BlueprintBuilder was dropped, and the
> alias/legacy-prop purge landed (no `aliases` in `widget-module.ts`/`registry.ts`).
> **Divergences from the written plan:** (1) `DataGrid` migrated to kind **`Listy`**, not
> `List` — Kubernetes reserves the `List` kind, so the mapped name in §0.1 and the
> appendix is superseded by [`cr-migration-map.json`](./cr-migration-map.json); (2) the
> structural kinds (`Page`/`Route`/`RoutesLoader`/`NavMenu`) were later removed entirely
> in the routes-as-data rework (out of this plan's scope — see
> [architecture.md](./architecture.md)). Kept as a dated decision record; the code wins.



## 0. Default rule & goal

**Rule: every widget's `widgetData` is a clean 1:1 mirror of its antd (or antd-ecosystem) component. No legacy props, no rename-aliases, no back-compat shims. Reshape the schema to match the component, regenerate the CRD, and migrate the CRs (hard-break).**

This replaces the earlier conservative "freeze the schema, swap only the renderer" stance. That conservatism was churn-aversion, and it conflicts with the north-star (1:1 antd), the documented convention ("widgets mirror antd names **and property schemas**"), the charts precedent (ECharts→plots reshaped the schemas), and the standing decision that *legacy CRs will be migrated*. Churn is an accepted cost, so we stop paying the fidelity tax to avoid it.

Audit baseline: **46 FAITHFUL, 7 STRUCTURAL, 4 DISCUSS** — but "FAITHFUL" still hides legacy props/aliases (below), which Phase 0 removes.

### Hard constraints (server-driven contracts)
- Source of truth = `X.schema.json` → `generate-types` → `X.type.d.ts`; `gen-crds` → the repo's own `crdgen/` Go module (was `krateoctl`, retired in #604). **Every schema change → regenerate types + CRDs + migrate CRs.**
- `validate-schemas`: if `spec.actions` exists it must contain all of `rest`/`navigate`/`openDrawer`/`openModal`.
- `widgetData` JSON-serializable; children via `resourcesRefs` → `WidgetRenderer`; events via `WidgetActions`/`useHandleAction`.
- Registry auto-discovers widgets via `index.ts` `defineWidget`.

---

## Phase 0 — Legacy & alias purge (the fidelity pass) ★ headline

Remove every back-compat affordance so each schema mirrors antd exactly. Concrete inventory (from the code):

### 0.1 Kind rename-aliases — delete (hard-break)
Remove the `aliases` from `defineWidget`, drop the `aliases` field from `widget-module.ts`, and remove the alias loop in `registry.ts`. Migrate CRs to the antd kind.

| Legacy `kind` | → antd `kind` | Defined at |
|---|---|---|
| `Panel` | `Card` | `Card/index.ts:5` |
| `Column` | `Col` | `Col/index.ts:5` |
| `TabList` | `Tabs` | `Tabs/index.ts:5` |
| `NavMenu` | `Menu` | `Menu/index.ts:5` |
| `DataGrid` | `List` | `List/index.ts:5` |

### 0.2 Per-widget legacy props — delete & require the antd-faithful prop
| Widget | Remove (legacy) | Require (antd) | Code |
|---|---|---|---|
| Table | `data`, `pageSize` | `dataSource`, `pagination.pageSize` | `Table/Table.tsx:17-20` |
| ButtonGroup | `gap` | `size` (antd `Space`) | `ButtonGroup/ButtonGroup.tsx:12-30` |
| Card | legacy `actions` | `widgetActions` | `Card/Card.tsx:37` |
| Button | `backgroundColor` | `color` + `variant` | `Button/Button.type.d.ts:201` |
| **all with actions** (Form, Card, Button, …) | `spec.actions.rest.payloadKey` | (send payload flat) | `*/X.type.d.ts` "DEPRECATED … nest the payload" |

### 0.3 Per-widget steps (repeat for each item above)
1. Edit `X.schema.json` — delete the legacy property; tighten the antd-faithful one (mark `required` where antd requires it).
2. Delete the back-compat read in `X.tsx` (e.g. the `legacy` cast in `Table.tsx`, the `legacyGapToSize` map in `ButtonGroup.tsx`, the `actions` fallback in `Card.tsx`, `backgroundColor` handling in `Button.tsx`).
3. `npm run generate-types` → regenerated `X.type.d.ts` (DEPRECATED entries vanish).
4. Update `src/examples/widgets/**/*.example.yaml` to the new shape/kind.
5. `npm run validate-schemas`; `npm run generate-crds` (needs a Go toolchain only — the generator is in-repo).
6. Update `registry.test.ts`: replace the "aliases resolve" assertions with "legacy kinds **do not** resolve; only antd kinds do."

**Effort:** M–L (touches ~8 widgets + registry + tests + examples). **Risk:** breaks any un-migrated CR → mitigated by the §Cutover migration mapping.

---

## Phase A — FlowChart → `@ant-design/graphs` (reshape schema to the component)

Read-only viewer (`nodesConnectable={false}`), clean fit for a graphs viewer; mirrors the plots chart migration.
1. Add `@ant-design/graphs` (v2.x, G6-based); lazy-load + `Suspense` like the charts.
2. **Reshape `widgetData` to mirror the graphs API** (data model + layout/field config), the way the charts mirror plots — *not* the old reactflow shape. Regenerate types + CRD; migrate CRs.
3. Port `FlowChartNodeElement` (antd `Avatar`/`Space`/`Flex`/`Tooltip`) to a graphs custom React node, 1:1 visual.
4. Remove `reactflow` from FlowChart's 3 files (stays installed for BlueprintBuilder); **remove `@dagrejs/dagre`** (graphs has built-in layout; FlowChart was its only user).
5. Dark-theme the graph by mode. **Effort:** M. **Fallback:** keep reactflow + dark-theme only (Phase C) if graphs can't match the node.

---

## Phase B — Keep the irreducible non-antd renderers (documented)

No antd core *or* ecosystem equivalent → keep the lib, faithful chrome around it:
- **Markdown** (react-markdown), **YamlViewer** (react-syntax-highlighter), **BlueprintBuilder** (reactflow *editable* canvas — graphs only views).
- Action: add a "non-antd dependencies" section to `docs/widget-authoring.md` + one-line code comment each, citing the principle. (Their schemas still get the Phase 0 purge — e.g. drop `payloadKey`.) **Effort:** S.

---

## Phase C — Dark-mode coverage for kept third-party renderers
1. **YamlViewer** — mode-aware hljs style (drop hardcoded `lightfair`).
2. **BlueprintBuilder/HelmPreview** — same.
3. **Markdown** — render inherits antd text tokens (dark text).
4. **reactflow canvas** — dark via CSS vars / `colorMode`; revisit global `reactflow/dist/style.css` import in `App.tsx`. **Effort:** S–M.

---

## Phase D — Hygiene & polish
1. **Declare direct deps:** `react-dom`, `@ant-design/icons` (used app-wide, only transitive today).
2. **Breadcrumb a11y:** `<span onClick>` → `Typography.Link`/`href`.
3. **(Done)** ButtonPagination debug DOM removed; Bar/Pie JSDoc fixed. **Effort:** S.

---

## Phase E — antd 5 → 6 (optional, separate, larger track)
`^5.24` → 6.x on its own branch: assess removed/renamed APIs, theme/algorithm + `cssVar` behavior (just enabled — re-verify), React 19 compat, icons; full light+dark QA. **After A–D. Effort:** L. **Risk:** M–H.

---

## Cutover & CR-migration strategy (hard-break)
- **In-repo:** update every `src/examples/**/*.example.yaml` to new kinds/props; CI regenerates CRDs (`gen-crds` via krateoctl) and pushes to the chart repo (existing pipeline).
- **Cluster CRs:** apply the migration mapping (§0.1 + §0.2) as a one-shot transform to live Widget CRs — owned by the cluster/backend side per the "legacy CRs will be migrated" decision. Ship the mapping table as the spec for that transform.
- **No transitional aliases** (hard-break) — old kinds/props stop resolving the moment the purge lands, so the CR migration must run in lockstep with the deploy.

## Verification gate (every phase)
`tsc` · `eslint` · `lint:css` · `vitest` (incl. updated `registry.test.ts`) · `vite build` · `generate-types` · `validate-schemas` · `generate-crds` (when a schema changed) · visual QA in **both** light and dark.

## Sequencing
**D (hygiene) → Phase 0 (purge) → A (FlowChart) → C (dark) → B (docs).** Phase 0 + A share the schema→CRD→CR-migration pipeline, so batch their CRD regen + CR migration into one cutover. **E** later, standalone.

---

## Appendix — migration mapping (single source for the CR transform)

**Kinds:** `Panel→Card`, `Column→Col`, `TabList→Tabs`, `NavMenu→Menu`, `DataGrid→List`.

**Props:** `Table.data→dataSource`, `Table.pageSize→pagination.pageSize`, `ButtonGroup.gap→size`, `Card.actions→widgetActions`, `Button.backgroundColor→color`(+`variant`), `*.spec.actions.rest.payloadKey→`(removed; payload flat).

**Dependency deltas:** `+ @ant-design/graphs`, `+ react-dom` & `+ @ant-design/icons` (explicit), `− @dagrejs/dagre` (after A); `reactflow` retained (BlueprintBuilder).
