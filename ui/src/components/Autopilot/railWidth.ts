/**
 * The rail's width geometry: the persisted user-resizable base width, the fixed extra the
 * history split adds, and the responsive clamps that keep a wide persisted width from
 * crushing `main` on a narrow viewport.
 *
 * Split out of AutopilotRail.tsx so the arithmetic is readable (and testable) apart from
 * the component that drags it. Mirrors the max-width backstop in AutopilotRail.module.css.
 */

// User-resizable base width (the docked width before the history split's fixed +256px extra —
// see HISTORY_EXTRA_WIDTH below — or the full-width override). Persisted across sessions the same
// way ThemeModeContext persists its mode: read once at mount, written on drag-end only (not on
// every pointermove, to avoid hammering localStorage mid-drag).
export const RAIL_WIDTH_STORAGE_KEY = 'krateo-autopilot-rail-width'
const RAIL_MIN_WIDTH = 320
const RAIL_MAX_WIDTH = 720
const RAIL_DEFAULT_WIDTH = 384
// Kept equal to 640 - 384, the pre-resize .apRail.open.split delta, so a never-resized rail is
// byte-identical to the old fixed-width behavior.
export const HISTORY_EXTRA_WIDTH = 256

export const clampRailWidth = (value: number) => Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, value))

// Responsive guard: on a narrow viewport, a persisted-wide `railWidth` (dragged on a bigger
// screen) or the history split's fixed +256 must not crush `main` to nothing. Mirrors the
// max-width backstop in AutopilotRail.module.css (which wins regardless, even before this
// runs) but also keeps the drag itself from fighting that CSS clamp mid-gesture — without it,
// the handle would visually detach from the cursor once the box hit its CSS max-width while
// `railWidth` kept climbing underneath. ABSOLUTE_MIN_DOCK is the floor even on a tiny viewport,
// matching the CSS backstop's own floor (never squeeze the rail into something unusable).
const ABSOLUTE_MIN_DOCK = 240
const NARROW_VIEWPORT = 640
export const maxDockableWidth = (viewportWidth: number) => Math.max(ABSOLUTE_MIN_DOCK, viewportWidth - (viewportWidth <= NARROW_VIEWPORT ? 64 : 200))

export const getStoredRailWidth = (): number => {
  const stored = Number(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampRailWidth(stored) : RAIL_DEFAULT_WIDTH
}
