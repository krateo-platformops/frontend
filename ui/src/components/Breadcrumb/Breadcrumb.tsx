import { Breadcrumb as AntdBreadcrumb, Typography } from 'antd'
import type { BreadcrumbItemType } from 'antd/es/breadcrumb/Breadcrumb'
import { type ReactNode, useMemo } from 'react'
import { Link, useMatches } from 'react-router'

import { useRoutesContext } from '../../context/RoutesContext'

import styles from './Breadcrumb.module.css'

/** A leaf name longer than this is drawn in two parts, so a cut falls in its middle (below). */
const SPLIT_FROM = 24
/** About how much of a long name's END always stays visible. */
const TAIL_LENGTH = 14

/**
 * Where a long name is split: at the first separator within its last TAIL_LENGTH characters, so the
 * visible end is a whole part of the name ("-20261123-1"), or that many characters when there is
 * none. Undefined when the name is short enough to be drawn whole.
 */
export const splitLeaf = (name: string): [head: string, tail: string] | undefined => {
  if (name.length <= SPLIT_FROM) { return undefined }
  const from = name.length - TAIL_LENGTH
  const separator = [...name.slice(from)].findIndex((character) => '-._/:'.includes(character))
  const at = separator >= 0 ? from + separator : from
  return [name.slice(0, at), name.slice(at)]
}

/**
 * The shell's breadcrumb, at the top of the page's content (UX audit BC-1, 2026-11-25):
 *
 *   - Only on a page BELOW a first-level one. On a first-level page (/compositions) it was one crumb
 *     repeating the page's own title, so nothing is drawn, the wrapper included.
 *   - Only the SECTION crumb is the upper-case eyebrow. Route words and object names keep their own
 *     case: names are case-sensitive and people copy them, and upper-casing them showed a name the
 *     object does not have ("KRATEO-SYSTEM / EVENT-FEEDBACK-FORM", a trace id in capitals).
 *   - A long last crumb is cut in the MIDDLE: its end, the part that tells two names apart
 *     ("sre-certificate-expiry-warning-20261123-1"), always stays visible, and the full name is the
 *     crumb's title. The text in the page is the whole name either way, so it copies whole.
 */
const Breadcrumb = ({ className }: { className?: string }) => {
  const matches = useMatches()
  const { menuRoutes } = useRoutesContext()
  const path = matches.filter(({ pathname }) => pathname !== '/')[0]?.pathname?.replace('/', '')

  const items = useMemo((): Partial<BreadcrumbItemType>[] => {
    const splitPath = (path ?? '').split('/').filter(Boolean)
    if (splitPath.length < 2) { return [] }

    return splitPath.map((pathElement, index) => {
      const isLast = index === splitPath.length - 1
      // Truncation bias (#69 §0.1): only the LEAF crumb (a long K8s resource name) is allowed to
      // shorten; the section + namespace crumbs — the CLICKABLE ones — stay fully readable. The
      // per-position flex-shrink in the CSS makes the last crumb the single shrink target.
      const className = [styles.breadcrumbItem, index === 0 ? styles.section : '', isLast ? styles.leaf : ''].filter(Boolean).join(' ')
      // The section crumb shows the route's NAV LABEL, not the raw slug (/kog-builder reads "API
      // Builder", matching the sidebar item and the page H1). The label comes from the same chart nav
      // CR that feeds the sidebar, so they cannot drift; routes without a labelled nav entry fall
      // back to the slug. Deeper segments stay verbatim on purpose — they are Kubernetes resource
      // names.
      const sectionLabel = index === 0
        ? menuRoutes.find((route) => route.path === `/${pathElement}`)?.title
        : undefined
      const crumbText = sectionLabel ?? pathElement
      // The first crumb (the section) links to its list route, ONLY if that list route exists: the
      // nav declares only the six-segment detail route for `/resources`, so an unconditional link
      // 404'd. `menuRoutes` is the nav's own route list. On a composition detail route
      // (/compositions/:namespace/:name) the namespace crumb links to the per-namespace list. Other
      // intermediate segments have no list route, so they stay plain text.
      let to: string | undefined
      if (index === 0 && !isLast) {
        to = menuRoutes.some((route) => route.path === `/${splitPath[0]}`) ? `/${splitPath[0]}` : undefined
      } else if (index === 1 && !isLast && splitPath[0] === 'compositions') {
        to = `/${splitPath[0]}/${splitPath[1]}`
      }

      const parts = isLast ? splitLeaf(crumbText) : undefined
      let text: ReactNode = crumbText
      if (to) {
        text = <Link className={styles.link} to={to}>{crumbText}</Link>
      } else if (parts) {
        text = <><span className={styles.leafHead}>{parts[0]}</span><span className={styles.leafTail}>{parts[1]}</span></>
      }

      // No antd `ellipsis` (its JS measurement over-truncates even with room): the CSS shortens
      // only past the cap, and `title` is the tooltip with the whole name.
      return { title: <Typography.Text className={className} title={crumbText}>{text}</Typography.Text> }
    })
  }, [path, menuRoutes])

  if (items.length === 0) { return null }
  return <div className={className}><AntdBreadcrumb items={items}/></div>
}

export default Breadcrumb
