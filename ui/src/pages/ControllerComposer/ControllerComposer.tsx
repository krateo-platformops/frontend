/**
 * The Controller Composer (T8, frontend#412) — the Controller Builder mounted by the composer host.
 * Its route is the Builder's (builders/host/builderRoutes.tsx); this component is the same host, named,
 * for whoever mounts the Controller Builder directly (its tests).
 *
 * It mounts bare, with no AutopilotProvider above it: it WRITES only through the window buses — start,
 * preview, the files batch, file edits, undo, close, publish — and never publishes (Publish asks the
 * provider, which runs the destination form and the blast-radius confirm a person answers).
 */
import { builderRegistry } from '../../builders/builderRegistry'
import ComposerHost from '../../builders/host/ComposerHost'

/** The Builder this composer hosts, by name. */
const BUILDER = 'controller-builder'

const ControllerComposer = () => <ComposerHost builder={builderRegistry.get({ name: BUILDER })} name={BUILDER} />

export default ControllerComposer
