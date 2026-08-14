// @vitest-environment jsdom
/**
 * Regression guard for #37 — "Open Drawer closes spontaneously (reloadRoutes/Shell remount resets
 * Drawer isOpen state)". The Drawer is mounted inside the ShellRoute subtree, which React remounts on
 * every router-version bump (<RouterProvider key={routerVersion}>) or Layout refresh. With isOpen in a
 * local useState that remount reset it to false and the open drawer vanished. Open-state now lives in a
 * module store, so unmounting + remounting the component keeps it open — proven below by NOT re-opening
 * it after the remount.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Drawer, { closeDrawer, openDrawer } from './Drawer'

// The real WidgetRenderer pulls the whole widget/data stack; the Drawer's open-state is independent of it.
vi.mock('../../components/WidgetRenderer', () => ({ default: () => <div>drawer-widget</div> }))

afterEach(() => {
  act(() => { closeDrawer() })
  cleanup()
})

describe('Drawer — #37 open-state survives remount', () => {
  it('stays open after the host subtree unmounts + remounts (no re-open)', () => {
    const { unmount } = render(<Drawer />)
    // Closed initially -> renders nothing.
    expect(screen.queryByText('Deploy to fleet')).toBeNull()

    act(() => { openDrawer({ title: 'Deploy to fleet', widgetEndpoint: '/call?name=deploy' }) })
    expect(screen.queryByText('Deploy to fleet')).not.toBeNull()

    // Simulate the ShellRoute remount (router-version bump). We do NOT call openDrawer again.
    unmount()
    render(<Drawer />)

    // The module store kept isOpen=true, so the fresh mount is still open — this is the #37 fix
    // (a local useState would have reset to closed here).
    expect(screen.queryByText('Deploy to fleet')).not.toBeNull()

    // And an explicit close still works across the store.
    act(() => { closeDrawer() })
    expect(screen.queryByText('Deploy to fleet')).toBeNull()
  })
})
