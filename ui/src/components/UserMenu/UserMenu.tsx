import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { MenuProps } from 'antd'
import { Avatar, Badge, Menu, Popover, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { useThemeMode } from '../../context/ThemeModeContext'
import type { AuthResponseType } from '../../pages/Login/Login.types'
import { clearClientSession } from '../../utils/logout'
import { useNotifications } from '../Notifications/NotificationsContext'

import styles from './UserMenu.module.css'

interface Props {
  /** R1: below `sm` the header has no room for the bell and the theme toggle, so they move in here
   * (HeaderChrome sets this). Same actions, same names, as the header buttons they stand in for. */
  withPageUtilities?: boolean
}

const UserMenu = ({ withPageUtilities = false }: Props) => {
  const { refetch } = useConfigContext()
  const { mode, toggle } = useThemeMode()
  const { notifications, setOpen: setNotificationsOpen } = useNotifications()
  // Controlled so the trigger can announce its state via aria-expanded. antd's Popover is
  // uncontrolled by default, which leaves a screen reader no way to know the menu is open.
  const [open, setOpen] = useState(false)

  const userData = JSON.parse(localStorage.getItem('K_user') || '{}') as AuthResponseType
  const { avatarURL, displayName, username } = userData.user || {}

  const fullName = (displayName !== '' ? displayName : username) || ''
  const initials = fullName
    .trim()
    .split(' ')
    .map(word => word[0]?.toUpperCase())
    .slice(0, 2)
    .join('')

  // The authenticated identity's real access groups (from the K_user login payload). There is
  // no separate "role" field, so surface the actual groups instead of a fabricated label.
  const groups = (userData.groups ?? []).join(' · ')

  const onLogout = async () => {
    try {
      // Shared with the standalone /logout recovery route (src/utils/logout.ts).
      await clearClientSession()
      // Refetch config.json so the post-redirect bootstrap starts clean.
      await refetch()
    } catch (error) {
      console.error('Logout cleanup error', error)
    } finally {
      window.location.replace('/login')
    }
  }

  // The bell's warning dot travels with it (Notifications.tsx NotificationsBell).
  const hasWarning = (notifications ?? []).some(ev => ev.type === 'Warning')
  const pageUtilities: MenuProps['items'] = withPageUtilities
    ? [
      {
        icon: <FontAwesomeIcon icon={['fas', 'bell'] as IconProp} />,
        key: 'notifications',
        label: hasWarning ? <Badge dot offset={[6, 0]} status='warning'>Notifications</Badge> : 'Notifications',
        onClick: () => { setOpen(false); setNotificationsOpen(true) },
      },
      {
        icon: <FontAwesomeIcon icon={['fas', 'circle-half-stroke'] as IconProp} />,
        key: 'theme',
        label: mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
        onClick: toggle,
      },
      { key: 'page-utilities-divider', type: 'divider' },
    ]
    : []

  const items: MenuProps['items'] = [
    ...pageUtilities,
    {
      key: '1',
      label: <Link to='/profile'>Profile</Link>,
    },
    {
      key: '2',
      label: <Link to=''>Logout</Link>,
      onClick: () => { void onLogout() },
    },
  ]

  return (
    <Popover
      arrow={false}
      className={styles.popover}
      content={
        <section className={styles.panel}>
          <div className={styles.userData}>
            <Avatar
              gap={2}
              size={80}
              src={avatarURL}
            >
              {/* A plain span: the initials take the avatar's own ink (`colorTextLightSolid`, which
                  the theme sets for its fill). Typography.Text painted them `colorText`, 2.97:1 on
                  the light fill and 2.99:1 on the dark one. */}
              <span className={styles.initials}>{initials}</span>
            </Avatar>

            <div className={styles.details}>
              <Typography.Text className={styles.fullname}>{fullName}</Typography.Text>
              {groups && <Typography.Text className={styles.role}>{groups}</Typography.Text>}
            </div>
          </div>

          <Menu
            className={styles.menu}
            items={items}
            mode='vertical'
            selectable={false}
          />
        </section>
      }
      onOpenChange={setOpen}
      open={open}
      placement='topLeft'
      trigger='click'
    >
      {/*
        * antd's Popover binds only `onClick` to its child — it adds NO keyboard affordance unless
        * that child is already focusable. `Avatar` renders a <span>, so the whole account menu
        * (profile, logout) was unreachable without a mouse, on every page. Wrapping in a real
        * <button> gives it focus, a role, Enter/Space activation and the global :focus-visible ring
        * for free; `aria-haspopup`/`aria-expanded` announce what it does and its current state.
        */}
      <button
        aria-expanded={open}
        aria-haspopup='menu'
        aria-label='Account menu'
        className={styles.trigger}
        type='button'
      >
        <Avatar
          gap={2}
          size='default'
          src={avatarURL}
        >
          {initials}
        </Avatar>
      </button>
    </Popover>
  )
}

export default UserMenu
