import { Drawer as AntdDrawer } from 'antd'
import { useState, useSyncExternalStore } from 'react'

import { DrawerHeader, drawerCloseProps } from '../../components/DrawerHeader/DrawerHeader'
import WidgetRenderer from '../../components/WidgetRenderer'

import { DrawerProvider } from './DrawerContext'

interface DrawerProps {
  widgetEndpoint: string
  size?: 'default' | 'large' | undefined
  title?: string | undefined
}

// --- module-level open-state store (survives every React remount). #37 -----------------------------
// The Drawer is mounted inside the ShellRoute subtree, which React unmounts+remounts whenever the
// router version bumps (registerRoutes -> <RouterProvider key={routerVersion}>) or the server-driven
// Layout refreshes. A React `useState` for isOpen would reset to false on any such remount, so an open
// drawer (e.g. Deploy-to-fleet) would vanish under the user within ~30-90s. Keeping {isOpen, properties}
// OUTSIDE the React tree means no remount at any level can close it — the component re-reads the live
// store on mount. Mirrors the Notifications drawer store (NotificationsContext.tsx).
interface DrawerState {
  isOpen: boolean
  properties: DrawerProps | null
}

let drawerState: DrawerState = { isOpen: false, properties: null }
const listeners = new Set<() => void>()

const store = {
  getSnapshot: (): DrawerState => drawerState,
  set: (next: DrawerState): void => {
    drawerState = next
    listeners.forEach((listener) => { listener() })
  },
  subscribe: (callback: () => void): (() => void) => {
    listeners.add(callback)
    return () => { listeners.delete(callback) }
  },
}
// ---------------------------------------------------------------------------------------------------

export const openDrawer = (properties: DrawerProps) => {
  store.set({ isOpen: true, properties })
}

export const closeDrawer = () => {
  // Keep the last properties (matches the pre-#37 behaviour: closing never cleared them) so the panel's
  // close transition still renders; `destroyOnHidden` tears the content down, the next openDrawer replaces.
  store.set({ isOpen: false, properties: drawerState.properties })
}

const Drawer = () => {
  const { isOpen, properties } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [drawerData, setDrawerData] = useState<{ title?: string; extra?: React.ReactNode }>({})

  if (!properties) {
    return null
  }

  const { size, title, widgetEndpoint } = properties

  return (
    <AntdDrawer
      // #86 §0.10: shared close placement (X at the END), from the one drawerCloseProps source.
      closable={drawerCloseProps.closable}
      destroyOnHidden
      extra={drawerData.extra}
      key={
        /* This make sure that the content of the drawer is destroyed and recreated when
        the drawer is closed and reopened, to prevent the form from showing stale data
        */
        isOpen ? 'open' : 'closed'
      }
      onClose={() => {
        closeDrawer()
        setDrawerData({})
      }}
      open={isOpen}
      // Inset the drawer's right edge by the docked Autopilot rail width (a :root var the rail
      // publishes; 0 when the rail is closed/absent) so the mask + panel cover the content and
      // never sit over the rail — honouring "the rail is never overlaid".
      rootStyle={{ right: 'var(--autopilot-rail-width, 0px)' }}
      size={size || 'default'}
      // #86 §0.10: title via the shared DrawerHeader (default 16px tier) — consistent typography
      // across every drawer. The title string is unchanged (openDrawer dispatch untouched).
      title={<DrawerHeader title={drawerData.title || title} />}
    >
      <DrawerProvider setDrawerData={setDrawerData}>
        <WidgetRenderer key={'drawer'} widgetEndpoint={widgetEndpoint} />
      </DrawerProvider>
    </AntdDrawer>
  )
}

export default Drawer
