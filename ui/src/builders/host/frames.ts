/**
 * The two frames a composer's slots sit in, by the name its canvas plugin declares (T4, frontend#410).
 *
 * - `panes` — the Blueprint Composer's layout, and the host's default shape: an in-page head (eyebrow
 *   `<label> / Compose`, the draft's name and a mono meta line, the save indicator, the file-count and
 *   "Preview needed" pills, Preview · Undo · Publish · Close draft, Publish gated with its reason), then
 *   palette 200px | centre (canvas over the files pane) | side 300px, each pane its own scroller.
 * - `split` — the Page Composer's: a title and subtitle head with the actions under it, then palette
 *   | centre (canvas, a draggable SplitDivider, the live result below it — which Preview scrolls to)
 *   | the object tree. A page canvas grows with the page, and the live render wants the width.
 *
 * WHY THE FRAME IS THE CANVAS PLUGIN'S. The Builder names its canvas; the canvas decides how much room
 * it needs and where the result sits against it. A new builder that reuses a canvas gets its frame.
 *
 * WHERE THE STYLES LIVE. Each frame's rules stay in the stylesheet they were written in: the slot
 * plugins of each builder share those same modules (a palette pane, an inspector section), and the
 * work-area and design-token tests read them by path. Moving them would rename every class for no
 * change on screen.
 */
import blueprintStyles from '../../pages/BlueprintComposer/BlueprintComposer.module.css'
import pageStyles from '../../pages/PageComposer/PageComposer.module.css'

import type { FrameName } from './hostTypes'

export const FRAME_STYLES: Record<FrameName, CSSModuleClasses> = {
  panes: blueprintStyles,
  split: pageStyles,
}
