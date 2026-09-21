/**
 * WHAT JUST HAPPENED, said out loud.
 *
 * The composer performed every structural edit in silence. A drag has its own feedback — the canvas
 * redraws and you watch it — but the TREE is the route for anyone not using a pointer, and pressing
 * "Move card-b up" produced no message, no focus change and no announcement: the tree re-rendered
 * and a screen-reader user was told nothing at all. WCAG 4.1.3 (Status Messages) exists for exactly
 * this, and it is what dnd-kit and react-beautiful-dnd both made table stakes with their live-region
 * APIs. The canvas gets announcements from dnd-kit for the drag itself; nothing covered the rest.
 *
 * ONE REGION, EVERY OUTCOME — successes and refusals alike. A live region that only speaks when
 * something goes wrong teaches people to ignore it, and "nothing was announced" then has two
 * meanings: it worked, or it did nothing.
 *
 * A BUS RATHER THAN A PROP, because the surfaces that perform edits — the tree, the canvas, the
 * compose handler the agent drives — are siblings under the page, and threading a callback through
 * all of them would put the same argument in ten signatures. Same idiom as the draft buses next
 * door, for the same reason.
 *
 * Pure module: one event, a dispatch/subscribe pair. No React, no module state.
 */

export const COMPOSER_ANNOUNCE_EVENT = 'krateoComposerAnnounce'

/** Say something. Called after the edit has been applied, so it describes what IS, not what was asked. */
export const announce = (message: string): void => {
  window.dispatchEvent(new CustomEvent<string>(COMPOSER_ANNOUNCE_EVENT, { detail: message }))
}

/** Subscribe. Returns the unsubscribe fn (React effect cleanup). */
export const onAnnounce = (handler: (message: string) => void): (() => void) => {
  const listener = (event: Event): void => {
    const { detail } = event as CustomEvent<string>
    if (typeof detail === 'string' && detail) {
      handler(detail)
    }
  }
  window.addEventListener(COMPOSER_ANNOUNCE_EVENT, listener)
  return () => window.removeEventListener(COMPOSER_ANNOUNCE_EVENT, listener)
}
