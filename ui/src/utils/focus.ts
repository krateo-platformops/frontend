/**
 * Focus primitives for the surfaces that hold keyboard focus without being an antd Modal or
 * Drawer: the docked Agentiko rail (components/Agentiko/focusTrap.ts) and the full-viewport
 * session-expired surface (hooks/useModalFocus.ts).
 */

/** What Tab can land on: the natively focusable controls plus anything given a non-negative tabindex. */
const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** The tab stops inside `container`, in document order. An element inside an `inert` subtree is
 * not one: the browser skips it, so a count that included it would describe a tab order no
 * keyboard user ever walks. */
export const tabbableIn = (container: ParentNode): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => !el.closest('[inert]'))

/**
 * Makes everything in the document except `keep` (and the ancestors that hold it) `inert`, and
 * returns the function that undoes it.
 *
 * It walks from `keep` up to `<body>` and marks every sibling at each level. That covers the app
 * tree around `keep` and the body-level portals that antd renders drawers, modals and messages
 * into, without moving `keep` out of the tree that gives it its context and inherited styles. An
 * element that was already `inert` is left alone, so the undo never re-enables what something
 * else disabled. Nodes added after the call are not marked: a popup that `keep` itself opens is
 * appended to `<body>` later, and it must stay usable.
 */
export const inertOutside = (keep: HTMLElement): (() => void) => {
  const marked: Element[] = []
  let node: HTMLElement = keep
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling !== node && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '')
        marked.push(sibling)
      }
    }
    node = node.parentElement
  }
  return () => {
    for (const el of marked) {
      el.removeAttribute('inert')
    }
  }
}
