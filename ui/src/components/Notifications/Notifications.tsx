import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Badge, Drawer, Empty, List, Skeleton, Tag, Tooltip, Typography } from 'antd'
import { memo, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router'

import { useConfigContext } from '../../context/ConfigContext'
import { LAYER } from '../../theme/layers'
import { getAccessToken } from '../../utils/getAccessToken'
import { carryScopeParams } from '../../utils/navigation'
import type { SSEK8sEvent } from '../../utils/types'
import { DrawerHeader, drawerCloseProps } from '../DrawerHeader/DrawerHeader'
import HeaderIconButton from '../HeaderIconButton'

import styles from './Notifications.module.css'
import { useNotifications } from './NotificationsContext'

const { Text } = Typography

// How many deduped events the drawer actually renders at once (the rest stay in cache). Rendering
// the full ~200-event set as antd List.Items at once was the dominant first-paint cost.
const VISIBLE_LIMIT = 50

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) { return '' }
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) { return 'just now' }
  if (diff < 3_600_000) { return `${Math.floor(diff / 60_000)}m ago` }
  if (diff < 86_400_000) { return `${Math.floor(diff / 3_600_000)}h ago` }
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface DedupedEvent {
  count: number
  event: SSEK8sEvent
}

function dedupeEvents(events: SSEK8sEvent[]): DedupedEvent[] {
  const groups = new Map<string, DedupedEvent>()
  for (const event of events) {
    const key = [
      event.type ?? '',
      event.reason ?? '',
      event.involvedObject.kind ?? '',
      event.involvedObject.name ?? '',
    ].join('\0')
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      const ta = new Date(existing.event.lastTimestamp ?? existing.event.firstTimestamp ?? existing.event.eventTime ?? 0).getTime()
      const tb = new Date(event.lastTimestamp ?? event.firstTimestamp ?? event.eventTime ?? 0).getTime()
      if (tb > ta) { existing.event = event }
    } else {
      groups.set(key, { count: 1, event })
    }
  }
  return Array.from(groups.values()).sort((ea, eb) => {
    if (ea.event.type === 'Warning' && eb.event.type !== 'Warning') { return -1 }
    if (ea.event.type !== 'Warning' && eb.event.type === 'Warning') { return 1 }
    const ta = new Date(ea.event.lastTimestamp ?? ea.event.firstTimestamp ?? ea.event.eventTime ?? 0).getTime()
    const tb = new Date(eb.event.lastTimestamp ?? eb.event.firstTimestamp ?? eb.event.eventTime ?? 0).getTime()
    return tb - ta
  })
}

/**
 * Resolved plurals, keyed `apiVersion/Kind`. Module-level so the lookup happens once per kind for
 * the life of the tab — a busy cluster repeats the same handful of kinds across dozens of events.
 */
export const pluralCache = new Map<string, string>()

/** The guess this code used to ship. Kept ONLY as the fallback when discovery is unavailable. */
const naivePlural = (kind: string) => `${kind.toLowerCase()}s`

/**
 * The real plural for a kind, from snowplow's `/api-info/names`.
 *
 * This used to be `kind.toLowerCase() + 's'`, which is wrong for every kind that does not
 * pluralise by appending s — `Repository` became `repositorys`, so the notification linked to a
 * URL the apiserver has no route for and the page 404'd on an object that exists. On the 057
 * cluster that guess is wrong for 45 CRD kinds: anything ending in y (Repository → repositories),
 * in s/x/ch/sh (Checkbox → checkboxes, ComputeClass → computeclasses), and every kind whose name
 * is ALREADY plural (AgentgatewayPolicies, ClusterRules), which must not be pluralised again.
 *
 * No rule reproduces that set, which is why this asks the apiserver rather than guessing better.
 */
export async function resolvePlural(baseUrl: string, apiVersion: string, kind: string): Promise<string> {
  const key = `${apiVersion}/${kind}`
  const cached = pluralCache.get(key)
  if (cached) { return cached }

  try {
    const url = `${baseUrl}/api-info/names?apiVersion=${encodeURIComponent(apiVersion)}&kind=${encodeURIComponent(kind)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
    if (!res.ok) { return naivePlural(kind) }
    const body = await res.json() as { plural?: string }
    if (!body.plural) { return naivePlural(kind) }
    pluralCache.set(key, body.plural)
    return body.plural
  } catch {
    // Navigation is better than no navigation: fall back to the old guess rather than dropping the
    // click. It is right for the majority of kinds and no worse than the previous behaviour.
    return naivePlural(kind)
  }
}

function toResourceUrl(event: SSEK8sEvent, plural: string): string | null {
  const obj = event.involvedObject
  if (!obj.kind || !obj.name) { return null }
  const ns = obj.namespace || 'cluster'
  const apiVer = obj.apiVersion ?? 'v1'
  let group = ''
  let version = apiVer
  if (apiVer.includes('/')) {
    const idx = apiVer.indexOf('/')
    group = apiVer.slice(0, idx)
    version = apiVer.slice(idx + 1)
  }
  return `/resources/${ns}/${group}/${version}/${plural}/${obj.name}`
}

// Memoized so a single new SSE event (which prepends one item to the list) re-renders only the
// new row, not all ~50 existing rows — keeps the live-updating drawer cheap on a busy cluster.
const EventItem = memo(function EventItem({ deduped, onNavigate }: { deduped: DedupedEvent; onNavigate: (url: string) => void }) {
  const { count, event } = deduped
  const ts = event.lastTimestamp ?? event.firstTimestamp ?? event.eventTime
  const isWarning = event.type === 'Warning'
  const objRef = [event.involvedObject.kind, event.involvedObject.name].filter(Boolean).join('/')
  const { config } = useConfigContext()
  const obj = event.involvedObject
  // Whether the row has a DESTINATION is decidable synchronously (kind + name); only the exact
  // plural needs the apiserver. Keeping the two apart matters for a11y: the row's focusability and
  // role must not wait on a fetch, or a keyboard user gets a tab stop that is briefly inert.
  const hasDestination = Boolean(obj.kind && obj.name)

  const go = useCallback(async () => {
    if (!obj.kind || !obj.name) { return }
    const base = config?.api?.SNOWPLOW_API_BASE_URL ?? ''
    const plural = await resolvePlural(base, obj.apiVersion ?? 'v1', obj.kind)
    const url = toResourceUrl(event, plural)
    if (url) { onNavigate(url) }
  }, [config?.api?.SNOWPLOW_API_BASE_URL, event, obj.apiVersion, obj.kind, obj.name, onNavigate])

  return (
    <List.Item
      actions={ts
        ? [
          <Tooltip key='ts' title={ts}>
            <Text style={{ fontSize: 11, whiteSpace: 'nowrap' }} type='secondary'>
              {formatTimestamp(ts)}
            </Text>
          </Tooltip>,
        ]
        : []}
      // a11y: `onClick` alone makes the row clickable with a mouse and unreachable without one —
      // a List.Item is not focusable, is announced as nothing, and ignores Enter and Space. Same
      // standard Table documents (WCAG 2.1.1) and ListView now shares. A row with no destination
      // stays inert, so a keyboard user never lands on a tab stop that does nothing.
      onClick={hasDestination ? () => { void go() } : undefined}
      onKeyDown={hasDestination
        ? (keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault()
            void go()
          }
        }
        : undefined}
      role={hasDestination ? 'button' : undefined}
      style={hasDestination ? { cursor: 'pointer' } : undefined}
      tabIndex={hasDestination ? 0 : undefined}
    >
      <List.Item.Meta
        avatar={
          <FontAwesomeIcon
            icon={isWarning ? (['fas', 'triangle-exclamation'] as IconProp) : (['fas', 'circle-info'] as IconProp)}
            // #80 (reiteration 3): centered against the whole item via `.list .ant-list-item-meta`
            // (Notifications.module.css) rather than the old top-aligned `marginTop: 2` nudge.
            // TOKENS, AND THE WARNING ONE IS AN ACCESSIBILITY FIX (T1). This read
            // `#faad14` / `#8c8c8c`. Measured against the light ground (#FFFFFF), `#faad14` is
            // 1.90:1 — under the 3:1 minimum for a non-text icon, so the triangle that says this
            // row needs attention was the least visible thing on it. In dark mode it is 8.97:1,
            // which is why it survived: the failure only existed in one theme.
            //
            // `--warning-color` is contrast-corrected per mode — 5.81:1 light (#8A5C00) and
            // 8.93:1 dark (#FFAA00). `--faint-color` is the de-emphasised token, 5.10:1 / 4.94:1,
            // replacing a grey that passed at 3.36:1 but tracked no theme.
            style={{ color: isWarning ? 'var(--warning-color)' : 'var(--faint-color)', fontSize: 16 }}
          />
        }
        description={
          <Text style={{ fontSize: 12 }} type='secondary'>
            {event.message ?? ''}
          </Text>
        }
        title={
          // #80 §0.9: the reason gets its OWN line (with a Tooltip surfacing the full text on
          // hover — it can still ellipsize), and the type/count/objRef metadata drops to a second
          // line beneath, so the four elements no longer crowd + clip each other on one row.
          <div style={{ minWidth: 0 }}>
            <Tooltip title={event.reason ?? ''}>
              <Text strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {event.reason ?? ''}
              </Text>
            </Tooltip>
            <div style={{ alignItems: 'center', display: 'flex', gap: 6, marginTop: 2, minWidth: 0 }}>
              <Tag color={isWarning ? 'warning' : 'default'} style={{ flexShrink: 0, margin: 0 }}>
                {event.type ?? 'Unknown'}
              </Tag>
              {count > 1 && (
                <Tag style={{ flexShrink: 0, margin: 0 }}>×{count}</Tag>
              )}
              {objRef && (
                <Text style={{ flexShrink: 1, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} type='secondary'>
                  {objRef}
                </Text>
              )}
            </div>
          </div>
        }
      />
    </List.Item>
  )
})

/**
 * The header bell + warning badge. Client-state only; it reads the shared notifications
 * context (open-state + data) so it can remount freely with the header chrome without
 * losing the drawer's open-state — that state lives in NotificationsProvider, above the
 * remount boundary. The Drawer itself is rendered by NotificationsDrawer at the stable
 * ShellRoute level (see Shell), so it never remounts and cannot flap shut.
 */
export const NotificationsBell = () => {
  const { notifications, setOpen } = useNotifications()
  const hasWarning = (notifications ?? []).some(ev => ev.type === 'Warning')

  // #80 §0.7: geometry and the accessible-name requirement both come from HeaderIconButton now.
  // The Badge wrapper below stays here — the dot is this component's state, not header chrome.
  const bellButton = (
    <HeaderIconButton
      ariaLabel='Notifications'
      icon={['fas', 'bell'] as IconProp}
      onClick={() => { setOpen(true) }}
    />
  )

  return (
    <span className={styles.badge}>
      {hasWarning
        ? <Badge dot offset={[-4, 4]} status='warning'>{bellButton}</Badge>
        : bellButton}
    </span>
  )
}

/**
 * The notifications drawer. Rendered ONCE at the stable ShellRoute level (a sibling of the
 * global Drawer/Modal overlays), NOT inside the header chrome — so the server-driven Layout
 * widget's remounts never tear it down. Reads open-state + data from the shared context.
 */
export const NotificationsDrawer = () => {
  const { isLoading, notifications, open, setOpen } = useNotifications()
  const navigate = useNavigate()

  // Dedupe once per data change, not on every render. The initial GET /events seeds up to
  // MAX_EVENTS (200) and each SSE message prepends one more, so recomputing this on every
  // render (incl. every SSE tick) was O(200) of churn that stalled the drawer's first paint
  // and its live updates. Memoized → the GET-seeded list paints immediately, SSE stays cheap.
  const deduped = useMemo(() => (notifications ? dedupeEvents(notifications) : []), [notifications])
  // Cap what we actually RENDER: a notifications drawer only needs the most relevant recent
  // events (warnings already sort first), and mounting 100+ antd List.Items at once was the
  // dominant cost (it froze the tab). The full set stays in cache; we render the top slice.
  const visible = useMemo(() => deduped.slice(0, VISIBLE_LIMIT), [deduped])

  const handleNavigate = useCallback((url: string) => {
    setOpen(false)
    // The event deep-link is a page change, so it carries the header's project scope along
    // rather than silently resetting it (see utils/navigation carryScopeParams).
    void navigate(carryScopeParams(url))
  }, [setOpen, navigate])

  const renderBody = () => {
    if (isLoading) {
      return <Skeleton active paragraph={{ rows: 6 }} />
    }
    if (deduped.length === 0) {
      return <Empty description='No events' image={Empty.PRESENTED_IMAGE_SIMPLE} />
    }
    return (
      <>
        <List
          className={styles.list}
          dataSource={visible}
          renderItem={item => (
            <EventItem
              deduped={item}
              key={`${item.event.involvedObject.kind ?? ''}/${item.event.involvedObject.name ?? ''}/${item.event.reason ?? ''}`}
              onNavigate={handleNavigate}
            />
          )}
          size='small'
          split
        />
        {deduped.length > VISIBLE_LIMIT && (
          <Text style={{ display: 'block', fontSize: 12, padding: '12px 0', textAlign: 'center' }} type='secondary'>
            Showing the {VISIBLE_LIMIT} most recent of {deduped.length} events
          </Text>
        )}
      </>
    )
  }

  return (
    <Drawer
      // #86 §0.10: shared close placement (X at the END, right of the title — the #80 house style),
      // now referenced from ONE source (drawerCloseProps) instead of re-declared per drawer.
      closable={drawerCloseProps.closable}
      onClose={() => setOpen(false)}
      open={open}
      // #86 §0.10: title via the shared DrawerHeader at the `prominent` tier (18px + bell icon) —
      // Notifications is deliberately more prominent than the generic/preview drawers. The extra
      // header padding stays scoped to THIS drawer (kept until a live diff confirms the tier alone
      // reproduces the height).
      styles={{ header: { paddingBottom: 18, paddingTop: 18 } }}
      title={<DrawerHeader emphasis='prominent' icon={['fas', 'bell'] as IconProp} title='Notifications' />}
      width={550}
      // C23: above the working surfaces on purpose — clicking the bell must always produce a
      // drawer you can see, whatever else is open. Previously tied with the widget drawer at
      // antd's base, so which one won was DOM order rather than a decision.
      zIndex={LAYER.NOTIFICATIONS}
    >
      {open && renderBody()}
    </Drawer>
  )
}
