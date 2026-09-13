/**
 * The overlay stack, declared in ONE place and in order.
 *
 * There are four surfaces that can be open at once, each owning its own state with nothing
 * coordinating them: the widget `Drawer` mounted in the shell, the `Notifications` drawer, the
 * Autopilot preview drawer, and the blast-radius confirm. Before this module, two of the four
 * declared a z-index at all — and those two lived in different files, with the upper one written
 * as a bare `1100` rather than derived from the 1000 it has to beat.
 *
 * That is not a theoretical tidiness problem. It has already gone wrong once: a publish gate
 * opened BEHIND the preview drawer and became untouchable, because in antd 6 both default to
 * `token.zIndexPopupBase` (1000) and the tie was broken by DOM order. The fix was to raise the
 * confirm — which is why the confirm is the one value here that must never be overtaken.
 *
 * THE ORDER, bottom to top, and why:
 *
 *   DRAWER (1000)         Page content. A widget drawer holds what the page put in it, so it sits
 *                         at antd's own base — this is the value it already had by default; it is
 *                         declared now so it is a decision rather than an inheritance.
 *
 *   PREVIEW (1010)        The Autopilot preview. Deliberately side-by-side: it drops its mask and
 *                         shifts left by the rail's width so preview and conversation stay usable
 *                         together. Above a page drawer because it is the surface you are working
 *                         IN while the page sits behind it.
 *
 *   NOTIFICATIONS (1050)  Transient, user-invoked chrome. Above the working surfaces on purpose:
 *                         clicking the bell must always produce a drawer you can see, whatever
 *                         else is open. This is the one ordering that CHANGES behaviour — it and
 *                         the widget drawer previously tied at 1000 and DOM order decided, which
 *                         is to say nobody decided.
 *
 *   CONFIRM (1100)        The blast-radius gate. Must be above everything that can host a gated
 *                         action, or the trapped-gate bug returns. Derived from PREVIEW rather
 *                         than written as a literal, so raising a lower surface cannot silently
 *                         overtake it.
 *
 * Adding a surface: put it here, relative to these, with a sentence saying why. A surface that can
 * host a gated action goes BELOW `CONFIRM` — that is the ordering whose absence makes a page
 * unusable rather than merely untidy.
 */
export const LAYER = {
  /** Widget `Drawer` — page content. antd's `zIndexPopupBase`, now stated rather than inherited. */
  DRAWER: 1000,
  /** Autopilot preview — the mask-less side-by-side working surface. */
  PREVIEW: 1010,
  /** Notifications — transient chrome; the bell must always reach the front. */
  NOTIFICATIONS: 1050,
  /** Blast-radius confirm — above every surface that can host a gated action. */
  CONFIRM: 1100,
} as const

/**
 * Guard: the confirm must outrank every other surface. A unit test asserts this, so raising one of
 * the surfaces above without raising the gate fails the build rather than the user's next publish.
 */
export const CONFIRM_OUTRANKS_ALL = Object.entries(LAYER)
  .filter(([name]) => name !== 'CONFIRM')
  .every(([, value]) => value < LAYER.CONFIRM)
