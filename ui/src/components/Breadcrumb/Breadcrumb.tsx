import { Breadcrumb as AntdBreadcrumb, Typography } from 'antd'
import type { BreadcrumbItemType, BreadcrumbSeparatorType } from 'antd/es/breadcrumb/Breadcrumb'
import { useEffect, useState } from 'react'
import { Link, useMatches } from 'react-router'

import { useRoutesContext } from '../../context/RoutesContext'

import styles from './Breadcrumb.module.css'

const Breadcrumb = () => {
  const [items, setItems] = useState<Partial<BreadcrumbItemType & BreadcrumbSeparatorType>[]>()
  const matches = useMatches()
  const { menuRoutes } = useRoutesContext()

  useEffect(() => {
    const path = matches.filter(({ pathname }) => pathname !== '/')[0]?.pathname?.replace('/', '')

    if (path) {
      const items: Partial<BreadcrumbItemType & BreadcrumbSeparatorType>[] = []
      const splitPath = path.split('/')

      splitPath.forEach((pathElement, index) => {
        const isLast = index === splitPath.length - 1
        // Truncation bias (#69 §0.1): only the LEAF crumb (a long K8s resource name) is
        // allowed to ellipsize; the section + namespace crumbs — the CLICKABLE ones — stay
        // fully readable. The `leaf` modifier + the per-position flex-shrink in the CSS make
        // the last crumb the single shrink target, so the first crumb is never the one cut.
        const className = `${styles.breadcrumbItem} ${index === 0 ? styles.capitalize : ''} ${isLast ? styles.leaf : ''}`
        // The section crumb shows the route's NAV LABEL, not the raw slug (/kog-builder
        // reads "API Builder", matching the sidebar item and the page H1). The label comes
        // from the same chart nav CR that feeds the sidebar, so they cannot drift; routes
        // without a labelled nav entry fall back to the slug. Deeper segments stay verbatim
        // on purpose — they are Kubernetes resource names.
        const sectionLabel = index === 0
          ? menuRoutes.find((route) => route.path === `/${pathElement}`)?.title
          : undefined
        const crumbText = sectionLabel ?? pathElement
        // The first crumb (the section) links to its list route. On a composition
        // detail route (/compositions/:namespace/:name) the namespace crumb links to
        // the per-namespace list /compositions/:namespace. Other intermediate segments
        // have no list route, so they stay plain text rather than become broken links.
        // No antd `ellipsis` (its JS measurement over-truncates even with room) — the
        // CSS truncates only past the cap; `title` is the tooltip.
        let to: string | undefined
        if (index === 0 && !isLast) {
          // ONLY if that list route actually exists. The section crumb used to link to
          // `/<segment>` unconditionally, which is right for the nine prefixes that have a list
          // page and wrong for `/resources`: the nav declares only the six-segment detail route
          // (`/resources/{namespace}/{group}/{version}/{plural}/{name}`), so every generic
          // resource page — a heavily used drill target from composition and incident tables —
          // offered a first crumb that 404s. `menuRoutes` is the nav's own route list, so this
          // asks the same source the label lookup above already uses, and a route added to the
          // chart later starts linking without a code change.
          to = menuRoutes.some((route) => route.path === `/${splitPath[0]}`)
            ? `/${splitPath[0]}`
            : undefined
        } else if (index === 1 && !isLast && splitPath[0] === 'compositions') {
          to = `/${splitPath[0]}/${splitPath[1]}`
        }

        items.push({
          title: (
            <Typography.Text className={className} title={crumbText}>
              {to
                ? <Link className={styles.link} to={to}>{crumbText}</Link>
                : crumbText}
            </Typography.Text>
          ),
        })
      })

      setItems(items)
    } else {
      setItems([{ title: '' }])
    }
  }, [matches, menuRoutes])

  return <AntdBreadcrumb items={items}/>
}

export default Breadcrumb
