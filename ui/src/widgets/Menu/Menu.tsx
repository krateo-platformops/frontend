import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Menu as AntdMenu } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { createRoute, useRoutesContext } from '../../context/RoutesContext'
import type { WidgetProps } from '../../types/Widget'
import { carryScopeParams, navigateOrExternal } from '../../utils/navigation'

import styles from './Menu.module.css'
import type { Menu as WidgetType } from './Menu.type'
import { buildNavModel, type InlineNavItem } from './navModel'

export type MenuWidgetData = WidgetType['spec']['widgetData']

export function Menu({ deniedRefIds, resourcesRefs, uid, widgetData }: WidgetProps<MenuWidgetData>) {
  const { items: navItems = [], mode, theme } = widgetData
  const location = useLocation()
  const navigate = useNavigate()
  const { menuRoutes, registerRoutes, updateMenuRoutes } = useRoutesContext()
  const { config } = useConfigContext()
  const namespace = config?.params.FRONTEND_NAMESPACE

  // Nav data is inline on widgetData.items (the folded form) — the single route source.
  // `deniedRefIds` rides along so the gate can tell "this ref was denied" from "no ref was
  // evaluated at all"; without it an upstream failure deletes the whole sidebar (frontend#295).
  const { entries, routes } = useMemo(
    () => buildNavModel(navItems as InlineNavItem[], resourcesRefs, namespace, deniedRefIds),
    [navItems, resourcesRefs, namespace, deniedRefIds]
  )

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

  const menuItems: ItemType[] = useMemo(
    () => entries.map((entry) =>
      (entry.type === 'divider'
        ? { key: entry.key, type: 'divider' as const }
        : {
          icon: entry.iconName ? <FontAwesomeIcon icon={entry.iconName as IconProp} /> : undefined,
          key: entry.key,
          label: entry.label,
        })
    ),
    [entries]
  )

  // Highlight the nav item whose path is the longest prefix of the current route, so
  // child routes (e.g. /compositions/:namespace, /compositions/:namespace/:name, the
  // marketplace create flow) keep their section selected. An exact match is naturally
  // the longest prefix; the trailing-slash guard stops /blueprints matching a sibling
  // like /blueprintsfoo. Dividers are skipped (their keys are 'divider-N', never a path match).
  const selectedKey = useMemo(() => {
    const path = location.pathname
    return menuItems
      .map((item) => (item as { key?: string }).key ?? '')
      .filter(Boolean)
      .filter((key) => path === key || path.startsWith(`${key}/`))
      .sort((left, right) => right.length - left.length)[0]
  }, [menuItems, location.pathname])

  const firstNavKey = useMemo(
    () => menuItems.find((item) => item?.type !== 'divider')?.key as string | undefined,
    [menuItems]
  )

  return (
    <AntdMenu
      className={styles.menu}
      defaultSelectedKeys={firstNavKey ? [firstNavKey] : []}
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
    />
  )
}
