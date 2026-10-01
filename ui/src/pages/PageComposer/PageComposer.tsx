/**
 * Page Composer — the Portal Builder's authoring surface: its Builder
 * CR (read from the cluster; authored as builders/fixtures/portal-builder.builder.yaml), mounted by
 * the composer host.
 *
 * WHAT IT IS NOW (T4, frontend#410). The page, its header, the split and the files pane are
 * ComposerHost's; the page editor is the page workbench (usePageWorkbench) drawn by the `widgets`
 * palette, the `page-grid` canvas and the `object-tree` inspector (pageSlots), which the Builder names.
 * The route is the Builder's too (builders/host/builderRoutes.tsx) — this component is the same host,
 * named, for whoever mounts the Portal Builder directly.
 *
 * WHY IT EXISTS AT ALL. The authoring surface — live render, Files tab with its per-file editor, the
 * RestDefinition editor — used to be reachable only as the Autopilot drawer, something the AGENT
 * opens. Here a person can start a draft, shape it and publish it. Autopilot loses nothing: it still
 * proposes drafts onto the same bus, and publishing still ends at a form a person submits.
 */
import { builderRegistry } from '../../builders/builderRegistry'
import ComposerHost from '../../builders/host/ComposerHost'

/** The Builder this composer hosts, by name. */
const BUILDER = 'portal-builder'

const PageComposer = () => <ComposerHost builder={builderRegistry.get({ name: BUILDER })} name={BUILDER} />

export default PageComposer
