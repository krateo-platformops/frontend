import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { Layout as AntdLayout, Drawer, Grid } from 'antd'
import { useRef, useState } from 'react'

import HeaderIconButton from '../../components/HeaderIconButton'
import { ShellSlotsProvider, useShellSlots } from '../../components/Shell/ShellSlots'
import type { ShellSlots } from '../../components/Shell/ShellSlots'
import WidgetRenderer from '../../components/WidgetRenderer'
import type { ResourcesRefs, WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'

import styles from './Layout.module.css'
import type { Layout as WidgetType } from './Layout.type'

export type LayoutWidgetData = WidgetType['spec']['widgetData']

const { Content, Footer, Header, Sider } = AntdLayout

/**
 * WCAG 1.4.10 (Reflow), audit item R1: the shell's responsive DEFAULT, so a Layout CR that sets
 * none of the Sider's responsive props still fits a tablet and a phone.
 *
 * - From `lg` (992 px) up, nothing changes: the Sider at its full width.
 * - Below `lg` the Sider collapses to antd's icon rail. That is antd's own `breakpoint` behaviour,
 *   so a CR's `breakpoint`, `collapsedWidth`, `collapsible` and `defaultCollapsed` still win.
 * - Below `md` (768 px) there is no room for even the rail, so the Sider leaves the layout and its
 *   content opens in an antd Drawer from a button in the header. That needs a header to put the
 *   button in; a Layout without one keeps the rail.
 */
const DEFAULT_SIDER_BREAKPOINT = 'lg'

/** The width the Sider has when nothing sets one: antd's own default. */
const ANTD_SIDER_WIDTH = 200

// Stable empty slots — a Layout resets the shell-slot context for its descendants
// (see render), so a nested Layout inherits none of the app-shell chrome.
const EMPTY_SHELL_SLOTS: ShellSlots = {}

const slot = (resourceRefId: string | undefined, resourcesRefs: ResourcesRefs) => {
  if (!resourceRefId) { return null }
  const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)
  return endpoint ? <WidgetRenderer widgetEndpoint={endpoint} /> : null
}

/**
 * Faithful wrapper of antd `Layout`: Header / Sider / Content / Footer regions,
 * each rendering a child widget resolved from `resourcesRefs`. When a Sider is
 * present it sits full-height on the left with Header/Content/Footer stacked
 * beside it (antd's canonical sidebar layout).
 */
const Layout = ({ resourcesRefs, widgetData }: WidgetProps<LayoutWidgetData>) => {
  const { content, effects, footer, hasSider, header, sider } = widgetData
  // The app shell (loaded via INIT) is the one Layout that reads real slots: regions
  // the CR leaves unset fall back to engine chrome (header → interactive controls,
  // content → the routed <Outlet/>, sider footer → the user block). Every Layout then
  // resets these to empty for its subtree (see the wrapped return), so a NESTED Layout
  // reads none of them and renders purely from its own resourceRefIds.
  const shell = useShellSlots()
  const headerContent = header ? slot(header, resourcesRefs) : shell.header
  const contentBody = content ? slot(content, resourcesRefs) : shell.content

  // Side-effect widgets (e.g. Theme): always-mounted, produce no UI. Rendered inside a
  // display:none host so an effect widget that accidentally emits markup can't disturb the
  // layout, while its React effects (which is where the global state is applied) still run.
  const effectNodes = (effects ?? []).map((refId) => {
    const endpoint = getEndpointUrl(refId, resourcesRefs)
    return endpoint ? <WidgetRenderer key={refId} widgetEndpoint={endpoint} /> : null
  })

  // R1 (see DEFAULT_SIDER_BREAKPOINT). `md === false` rather than `!md`: until antd's first
  // media-query answer `screens` is empty, and an unknown width keeps the Sider in the layout.
  const screens = Grid.useBreakpoint()
  const offCanvas = Boolean(sider) && Boolean(headerContent) && screens.md === false
  const [navOpen, setNavOpen] = useState(false)
  // Picking a page from the drawer closes it: a navigation changes the shell's routeKey. React's
  // "adjust state when a prop changes" pattern, so the drawer is never painted open on the new page.
  const [routeKey, setRouteKey] = useState(shell.routeKey)
  if (routeKey !== shell.routeKey) {
    setRouteKey(shell.routeKey)
    setNavOpen(false)
  }

  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuButton = offCanvas ? (
    <HeaderIconButton ariaExpanded={navOpen} ariaLabel='Navigation menu' icon={['fas', 'bars'] as IconProp} onClick={() => setNavOpen(true)} ref={menuButtonRef} />
  ) : null

  const regions = (
    <>
      {headerContent ? <Header className={styles.header}>{menuButton}{headerContent}</Header> : null}
      <Content className={styles.content}>{contentBody}</Content>
      {footer ? <Footer>{slot(footer, resourcesRefs)}</Footer> : null}
    </>
  )

  const siderColumn = sider ? (
    <div className={styles.sider}>
      {shell.siderHeader}
      <div className={styles.siderBody}>{slot(sider.resourceRefId, resourcesRefs)}</div>
      {shell.siderFooter}
    </div>
  ) : null

  // The Sider's slot stays in place while it is empty, so crossing `md` (a phone turned sideways)
  // never remounts the regions beside it, and with them the routed page and whatever it holds.
  const layout = !sider ? (
    <AntdLayout className={styles.shell}>{regions}</AntdLayout>
  ) : (
    <AntdLayout className={styles.shell} hasSider={hasSider ?? true}>
      {offCanvas ? null : (
        <Sider
          breakpoint={sider.breakpoint ?? DEFAULT_SIDER_BREAKPOINT}
          className={styles.siderRegion}
          collapsedWidth={sider.collapsedWidth}
          collapsible={sider.collapsible}
          defaultCollapsed={sider.defaultCollapsed}
          reverseArrow={sider.reverseArrow}
          theme={sider.theme}
          width={sider.width}
        >
          {siderColumn}
        </Sider>
      )}
      <AntdLayout>{regions}</AntdLayout>
    </AntdLayout>
  )

  // Below `md`: the same Sider content in a Drawer over the page. antd closes it on Escape and on a
  // tap on the mask. `forceRender` keeps it mounted while closed (hidden, so out of the
  // accessibility tree): the nav Menu inside is the app's route source, and the routes it registers
  // must exist before anyone opens the drawer.
  //
  // Focus goes back to the menu button by name, once the drawer has finished closing. antd's own
  // return goes to "whatever had focus when it opened", which a pre-rendered drawer can capture as
  // itself (seen in jsdom); the button is the one right answer however the drawer was closed.
  const navDrawer = offCanvas && sider ? (
    <Drawer
      afterOpenChange={(isOpen) => { if (!isOpen) { menuButtonRef.current?.focus() } }}
      aria-label='Navigation'
      closable={false}
      forceRender
      onClose={() => setNavOpen(false)}
      open={navOpen}
      placement='left'
      size={sider.width ?? ANTD_SIDER_WIDTH}
      styles={{ body: { padding: 0 } }}
    >
      <Sider className={`${styles.siderRegion} ${styles.drawerSider}`} theme={sider.theme} width='100%'>
        {siderColumn}
      </Sider>
    </Drawer>
  ) : null

  // Scope the app-shell slots to THIS Layout: descendants get empty slots, so a nested
  // Layout (rendered inside `content`) inherits no header / content / sider-footer chrome.
  return (
    <ShellSlotsProvider value={EMPTY_SHELL_SLOTS}>
      {effectNodes.length > 0 ? <div style={{ display: 'none' }}>{effectNodes}</div> : null}
      {layout}
      {navDrawer}
    </ShellSlotsProvider>
  )
}

export default Layout
