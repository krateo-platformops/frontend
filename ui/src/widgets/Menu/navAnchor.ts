/**
 * The DOM contract between the sidebar nav (this widget) and whatever has to FIND a nav item
 * on screen — today the Autopilot tour's `nav:<Label>` spotlight anchors.
 *
 * The tour used to locate nav items with `.ant-menu-item`, antd's own class, and its miss is
 * silent by design (a step with no target renders centered). Those two together are the trap:
 * a dependency's class name is its presentation choice and it moves — antd 6 renamed six of
 * ours under us (#588/#590) — and a rename here would have switched nav spotlights off
 * permanently with nothing to look at and nothing logged.
 *
 * So the hook is ours. The Menu stamps these attributes, `findNavItem` reads them, and
 * `Menu.navAnchor.test.tsx` pins that they reach the rendered DOM — the contract cannot break
 * without failing that test. antd *types* `data-*` passthrough on menu items (`DataAttributes`
 * in antd/es/menu/interface.d.ts), so this rides on its API rather than on its stylesheet.
 */

/** Marks the nav root: the witness that a sidebar nav IS rendered on this page. */
export const NAV_ROOT_ATTRIBUTE = 'data-krateo-nav'

/** Carries a nav item's label verbatim — the CSS capitalizes the text, the attribute doesn't. */
export const NAV_ITEM_ATTRIBUTE = 'data-krateo-nav-item'

/** Spread onto the nav root element. */
export const navRootProps: Record<string, string> = { [NAV_ROOT_ATTRIBUTE]: '' }

/** Spread into an antd menu item descriptor. A label-less entry stamps nothing. */
export const navItemProps = (label: string | undefined): Record<string, string | undefined> =>
  ({ [NAV_ITEM_ATTRIBUTE]: label })

export type NavItemLookup =
  /** The item is on screen. */
  | { element: HTMLElement; status: 'found' }
  /** No nav item with that label — the page has no nav, or no such entry. Degrade quietly. */
  | { element: null; status: 'absent' }
  /** A nav with rendered rows is on screen, yet not one carries our hook: the contract broke. */
  | { element: null; status: 'unhooked' }

/**
 * Find a sidebar nav item by its label, and say WHY when there isn't one — "this page has no
 * such nav entry" and "our anchors have stopped reaching the DOM" are both a null target, and
 * the caller must be able to tell them apart.
 */
export const findNavItem = (label: string): NavItemLookup => {
  const roots = [...document.querySelectorAll(`[${NAV_ROOT_ATTRIBUTE}]`)]
  const items = roots.flatMap((root) => [...root.querySelectorAll(`[${NAV_ITEM_ATTRIBUTE}]`)])

  const match = items.find((item) => item.getAttribute(NAV_ITEM_ATTRIBUTE)?.trim() === label)
  if (match instanceof HTMLElement) {
    return { element: match, status: 'found' }
  }
  // A nav that rendered rows but stamped none of them is broken, not empty. An RBAC-emptied nav
  // (no rows at all) and a nav-less page are both genuinely absent.
  if (items.length === 0 && roots.some((root) => root.querySelector('li'))) {
    return { element: null, status: 'unhooked' }
  }
  return { element: null, status: 'absent' }
}
