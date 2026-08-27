import { Avatar } from 'antd'
import { useEffect } from 'react'
import { Outlet } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import Drawer from '../../widgets/Drawer'
import Modal from '../../widgets/Modal'
import { AutopilotProvider, AutopilotShell, AutopilotToggle, BuilderMenu } from '../Autopilot'
import Breadcrumb from '../Breadcrumb'
import CommandPalette from '../CommandPalette'
import { NotificationsBell, NotificationsDrawer, NotificationsProvider } from '../Notifications'
import SessionResumeModal from '../SessionResume'
import ThemeToggle from '../ThemeToggle'
import UserMenu from '../UserMenu'
import WidgetRenderer from '../WidgetRenderer'

import styles from './Shell.module.css'
import { ShellSlotsProvider } from './ShellSlots'

/** Interactive app chrome rendered in the Layout header. Mostly client-state-driven controls
 * (breadcrumb, search, notifications…), PLUS the declarative `header-context` flex — the tenant
 * label + project (= namespace) switcher, moved from the sider into the topbar per the
 * multitenancy screenshot. The shell namespace is read from the INIT endpoint (nothing
 * hardcoded). */
const HeaderChrome = () => {
  const { config } = useConfigContext()
  const ns = new URLSearchParams((config?.api.INIT ?? '').split('?')[1] ?? '').get('namespace') ?? 'krateo-system'
  const headerContext = `/call?resource=flexes&apiVersion=widgets.templates.krateo.io/v1beta1&name=header-context&namespace=${ns}`
  return (
    <>
      <div className={styles.headerLeft}>
        <WidgetRenderer key='header-context' widgetEndpoint={headerContext} />
      </div>
      {/* Autopilot is a distinct surface, not a page utility — pull its toggle out of the
          search/notifications/theme cluster and set it beside the user menu, behind a divider. */}
      <div className={styles.headerRight}><CommandPalette /><BuilderMenu /><NotificationsBell /><ThemeToggle /><span className={styles.headerDivider} /><AutopilotToggle /><UserMenu /></div>
    </>
  )
}

/** Bottom-of-Sider block: the user (avatar + name from the token) above a subtle
 * build/version marker. The version is `package.json`'s `version` and the build is the
 * git short-SHA, both inlined at build time (vite.config.ts `define`) — nothing hardcoded. */
const SiderFooter = () => {
  const { user } = JSON.parse(localStorage.getItem('K_user') || '{}') as { user?: { avatarURL?: string; displayName?: string; username?: string } }
  const name = user?.displayName || user?.username || ''
  return (
    <div className={styles.siderFooter}>
      <div className={styles.siderUser}>
        <Avatar size={30} src={user?.avatarURL}>{name.slice(0, 1).toUpperCase()}</Avatar>
        <span className={styles.siderFooterName}>{name}</span>
      </div>
      <div className={styles.siderBuild} title={`build ${__APP_VERSION__} · ${__APP_BUILD__}`}>
        build {__APP_VERSION__} · {__APP_BUILD__}
      </div>
    </div>
  )
}

/**
 * The persistent app shell, as a React Router layout route. The visible chrome is
 * the server-driven `Layout` widget loaded from config `INIT` (its Sider hosts the
 * nav Menu, its Header/Content fall back to the shell slots below). This component
 * owns only what the engine must: the auth gate, the global Drawer/Modal
 * overlays, and the shell slots the Layout widget projects — the
 * routed `<Outlet/>` and the interactive header chrome. Child routes render into
 * the Outlet, so the shell mounts once and only the content swaps on navigation.
 */
export const ShellRoute = () => {
  const { config } = useConfigContext()

  useEffect(() => {
    if (!localStorage.getItem('K_user')) {
      window.location.replace('/login')
    }
  }, [])

  return (
    <ShellSlotsProvider value={{ content: <><div className={styles.contentCrumb}><Breadcrumb /></div><Outlet /></>, header: <HeaderChrome />, siderFooter: <SiderFooter /> }}>
      <NotificationsProvider>
        <AutopilotProvider>
          <AutopilotShell>
            <WidgetRenderer key='shell' widgetEndpoint={config!.api.INIT} />
          </AutopilotShell>
          <Drawer />
          <Modal />
          <SessionResumeModal />
          {/* Rendered here (not in the header chrome) so the server-driven Layout widget's
              remounts never tear it down — the header only carries the bell. */}
          <NotificationsDrawer />
        </AutopilotProvider>
      </NotificationsProvider>
    </ShellSlotsProvider>
  )
}

export default ShellRoute
