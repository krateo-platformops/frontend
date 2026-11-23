import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Menu as AntdMenu } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { type FocusEvent, type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { createRoute, useRoutesContext } from '../../context/RoutesContext'
import { spacing } from '../../theme/tokens'
import type { WidgetProps } from '../../types/Widget'
import { carryScopeParams, navigateOrExternal } from '../../utils/navigation'

import styles from './Menu.module.css'
import type { Menu as WidgetType } from './Menu.type'
import { navItemProps, navRootProps } from './navAnchor'
import { FailedNavIcon, FailedNavLabel, NavUncheckedNotice } from './NavFailure'
import { buildNavModel, type InlineNavItem, type NavEntry } from './navModel'

export type MenuWidgetData = WidgetType['spec']['widgetData']

/**
 * The antd items for the nav entries, in their order. A run of consecutive entries that name the
 * same `group` becomes one antd item group, whose title is the heading (Menu.module.css draws it as
 * a section label, and as a short rule in the collapsed icon rail). An entry with no group, and a
 * divider, stay at the top level and end the run, so a nav whose items carry no groups renders
 * exactly as it did before groups existed.
 */
const toMenuItems = (entries: NavEntry[], explained: string | undefined, explain: (key: string | undefined, target?: Element) => void): ItemType[] => {
  const items: ItemType[] = []
  let run: { children: ItemType[]; name: string } | undefined
  for (const entry of entries) {
    if (entry.type === 'divider') {
      run = undefined
      items.push({ key: entry.key, type: 'divider' })
      continue
    }
    const { failure } = entry
    const item: ItemType = {
      // Our own anchor for the label, so the Agentiko tour can spotlight this row without
      // reading antd's class names (navAnchor.ts).
      ...navItemProps(entry.label),
      icon: entry.iconName ? <FontAwesomeIcon icon={entry.iconName as IconProp} /> : undefined,
      key: entry.key,
      label: entry.label,
      // An entry snowplow could not check: marked, and explained on hover or focus of its row.
      ...(failure && {
        icon: <FailedNavIcon failure={failure} iconName={entry.iconName} />,
        label: <FailedNavLabel failure={failure} label={entry.label ?? ''} open={explained === entry.key} />,
        onBlur: () => { explain(undefined) },
        onFocus: (event: FocusEvent) => { explain(entry.key, event.currentTarget) },
        onMouseEnter: ({ domEvent }: { domEvent: MouseEvent }) => { explain(entry.key, domEvent.currentTarget) },
        onMouseLeave: () => { explain(undefined) },
      }),
    }
    if (!entry.group) {
      run = undefined
      items.push(item)
    } else if (run?.name === entry.group) {
      run.children.push(item)
    } else {
      run = { children: [item], name: entry.group }
      items.push({ children: run.children, key: `group-${entry.key}`, label: entry.group, type: 'group' })
    }
  }
  return items
}

export function Menu({ deniedRefIds, failedRefs, resourcesRefs, uid, widgetData }: WidgetProps<MenuWidgetData>) {
  const { items: navItems = [], mode, theme } = widgetData
  const location = useLocation()
  const navigate = useNavigate()
  const { menuRoutes, registerRoutes, updateMenuRoutes } = useRoutesContext()
  const { config } = useConfigContext()
  const namespace = config?.params.FRONTEND_NAMESPACE

  // Nav data is inline on widgetData.items (the folded form) — the single route source.
  // `deniedRefIds` rides along so the gate can tell "this ref was denied" from "no ref was
  // evaluated at all"; without it an upstream failure deletes the whole sidebar (frontend#295).
  // `failedRefs` are the refs snowplow could not check: shown and marked, never hidden (#533).
  const { entries, routes, unchecked } = useMemo(
    () => buildNavModel(navItems as InlineNavItem[], resourcesRefs, namespace, deniedRefIds, failedRefs),
    [navItems, resourcesRefs, namespace, deniedRefIds, failedRefs]
  )
  // The failed entry whose explanation is open. Not in the collapsed icon rail: antd's own tooltip
  // shows the label there, and the label carries the explanation.
  const [explained, setExplained] = useState<string>()
  const explain = useCallback((key: string | undefined, target?: Element) => {
    setExplained(target?.closest('.ant-menu-inline-collapsed') ? undefined : key)
  }, [])

  useEffect(() => {
    if (routes.length > 0) {
      localStorage.setItem('routes', JSON.stringify(routes))
      updateMenuRoutes(routes)
      // Register param-capable React-Router routes from the nav — the INIT route
      // source that replaces the routes-loader. registerRoutes dedups by path.
      registerRoutes(routes.flatMap((route) => (route.endpoint ? [createRoute({ endpoint: route.endpoint, path: route.path })] : [])))
    }
  }, [routes, updateMenuRoutes, registerRoutes])

  useEffect(() => {
    if (location.pathname === '/' && menuRoutes.length > 0) {
      // `/?projects=…` is a legitimate landing URL (a shared, project-scoped link), so the
      // redirect to the first nav page must keep the scope rather than drop it on arrival.
      void navigate(carryScopeParams(menuRoutes[0].path))
    }
  }, [location.pathname, menuRoutes, navigate])

  const menuItems: ItemType[] = useMemo(() => toMenuItems(entries, explained, explain), [entries, explained, explain])

  // Highlight the nav item whose path is the longest prefix of the current route, so
  // child routes (e.g. /compositions/:namespace, /compositions/:namespace/:name, the
  // marketplace create flow) keep their section selected. An exact match is naturally
  // the longest prefix; the trailing-slash guard stops /blueprints matching a sibling
  // like /blueprintsfoo. Read from the flat entries, not the antd items: an entry under a group
  // heading is a child of the group item there. Dividers have no path to match.
  const navKeys = useMemo(() => entries.flatMap((entry) => (entry.type === 'divider' ? [] : [entry.key])), [entries])
  const selectedKey = useMemo(() => {
    const path = location.pathname
    return navKeys
      .filter((key) => path === key || path.startsWith(`${key}/`))
      .sort((left, right) => right.length - left.length)[0]
  }, [navKeys, location.pathname])

  const [firstNavKey] = navKeys

  const nav = (
    <AntdMenu
      {...navRootProps}
      className={styles.menu}
      defaultSelectedKeys={firstNavKey ? [firstNavKey] : []}
      // antd writes this as the row's inline padding-left (indent × level, and every entry is level
      // one, grouped or not, since an item group adds no level). 8px inside the Sider's 16px padding
      // puts each icon on the rail's one left edge, x = 24, with the logo and the group headings.
      // In the collapsed icon rail antd centres the icon instead and writes no indent.
      inlineIndent={spacing.sm}
      items={menuItems}
      key={uid}
      mode={mode ?? 'inline'}
      // Through the shared entry point, NOT a bare `navigate(item.key)`: a nav key is a bare
      // pathname, so clicking the sidebar used to drop the whole query — wiping the header's
      // project scope on the first navigation (the reported bug). navigateOrExternal carries
      // the global scope params across.
      onClick={(item) => { navigateOrExternal(navigate, item.key) }}
      selectedKeys={selectedKey ? [selectedKey] : []}
      theme={theme}
      // R1: in the collapsed icon rail (a Sider below `lg`) antd names each icon in a tooltip, on
      // hover only by default. A keyboard user arrowing through the icons needs the same name, so
      // it opens on focus too. Outside a collapsed Sider antd shows no tooltip at all.
      tooltip={{ trigger: ['hover', 'focus'] }}
    />
  )
  if (!unchecked) { return nav }
  return (
    <>
      <NavUncheckedNotice failures={unchecked} />
      {nav}
    </>
  )
}
