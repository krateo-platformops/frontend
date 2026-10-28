/**
 * Blueprint Composer — the Blueprint Builder's authoring surface: its Builder
 * CR (read from the cluster; authored as builders/fixtures/blueprint-builder.builder.yaml), mounted
 * by the composer host.
 *
 * WHAT IT IS NOW (T4, frontend#410). The page, its header and its files pane are BuilderHost's; the
 * chart editor is the blueprint workbench (useBlueprintWorkbench) drawn by the `kinds` palette, the
 * `architecture-graph` canvas and the `node` inspector (blueprintSlots), which the Builder names. The
 * route is the Builder's too (builders/host/builderRoutes.tsx) — this component is the same host,
 * named, for whoever mounts the Blueprint Builder directly.
 *
 * It mounts bare, with no AutopilotProvider above it: it WRITES only through the window buses — start,
 * preview, file edit/add, the files batch, undo, close, publish — and never publishes (Publish asks
 * the provider, which runs the destination form and the blast-radius confirm a person answers).
 */
import { builderRegistry } from '../../builders/builderRegistry'
import BuilderHost from '../../builders/host/BuilderHost'

export { CHART_CHANGED, GATE_CAPTION } from './useBlueprintWorkbench'

/** The Builder this composer hosts, by name. */
const BUILDER = 'blueprint-builder'

const BlueprintBuilder = () => <BuilderHost builder={builderRegistry.get({ name: BUILDER })} name={BUILDER} />

export default BlueprintBuilder
