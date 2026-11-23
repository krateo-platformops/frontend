/* eslint-disable sort-keys/sort-keys-fix */
// Ordered by role (an item, its active state, the selected bar, a heading), not alphabetically.
/**
 * The sidebar nav's colours (`--krateo-nav-*`, emitted from tokens.ts KRATEO_BASE). Mode-invariant: the
 * Agentiko rail is black in both modes (T11), so its text is light in both. Contrast against both
 * rails (#000000 dark, #141414 light) is pinned in tokens.contrast.test.ts.
 */
export const sidebarNav = {
  // An idle item's label and icon.
  item: 'rgba(255, 255, 255, 0.62)',
  // The selected or hovered item's label.
  itemActive: '#FFFFFF',
  // The selected item's accent bar, 3px at its leading edge: the state itself, where the
  // `menuitembg` tint behind the row is only a background. The dark-mode primary #C27AFF in both
  // modes, like the rail it sits on: 7.52:1 on the dark rail, where the brand violet is 3.90:1.
  selectedBar: '#C27AFF',
  // A section heading (a page's `krateo.io/nav-group`): white at 55%, a step below the items'
  // 62%, so it reads as a label for them rather than as one of them.
  group: 'rgba(255, 255, 255, 0.55)',
  // The mark on an entry snowplow could not check (frontend#533): the dark palette's orange and error
  // in both modes, like the rail they sit on. `unchecked` can pass on a retry; `broken` cannot.
  unchecked: '#FFAA00',
  broken: '#F84C4C',
} as const
