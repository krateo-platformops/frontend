// @vitest-environment jsdom
/**
 * The page-level contract: a composition detail page whose composed child is NOT ready must not
 * open under a green pill, and the reader must be able to tell WHICH child and why.
 *
 * This renders the two widgets the real page renders — the `PageHeader` carrying the composition's
 * own server-resolved `Ready` tag, and the Relations `tree` list carrying the composed children —
 * inside the same page provider `WidgetPage` mounts, because the defect lived exactly in the gap
 * between them: each widget was individually correct.
 */
import { cleanup, render } from '@testing-library/react'
import { App } from 'antd'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

// antd List is responsive — it probes matchMedia, which jsdom lacks.
vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), isActionLoading: false }),
}))
vi.mock('../WidgetRenderer', () => ({ default: () => <div data-testid='action' /> }))

import type { ItemTemplate } from '../../widgets/List/itemTemplate'
import { ListView } from '../../widgets/List/ListView'
import PageHeader from '../../widgets/PageHeader/PageHeader'

import { PageHealthProvider } from './PageHealthContext'

/** The Relations list exactly as `list-composition-detail-relations` authors it. */
const RELATIONS_TEMPLATE = {
  color: { map: { drift: 'violet', failed: 'red', healthy: 'green', pending: 'orange' }, value: '{state}' },
  iconVariant: 'dot' as const,
  navigateTo: '{navHref}',
  primaryText: '{kind}',
  rowVariant: 'tree' as const,
  secondaryText: '{stateLabel}',
  subPrimaryText: '{name}',
}

const page = (children: unknown[]): ReactElement => (
  <MemoryRouter>
    <App>
      <PageHealthProvider>
        <PageHeader
          resourcesRefs={{ items: [] }}
          uid='ph'
          widgetData={{ items: [], tags: [{ color: 'green', label: 'Ready' }], title: 'payments' }}
        />
        <ListView itemTemplate={RELATIONS_TEMPLATE} items={children} rowKey='relations' />
      </PageHealthProvider>
    </App>
  </MemoryRouter>
)

const row = (kind: string, name: string, state: string, conditions?: unknown[]) => ({
  conditions,
  kind,
  name,
  navHref: `/resources/demo/apps/v1/${kind.toLowerCase()}s/${name}`,
  state,
  stateLabel: state.charAt(0).toUpperCase() + state.slice(1),
})

const headerPills = () => [...document.querySelectorAll('.ant-tag')].map((tag) => tag.textContent ?? '')

/** The header's composed-children pill — the thing this whole seam exists to draw. */
const childPill = () => document.querySelector<HTMLElement>('[class*="childHealth"]')

describe('composition detail — the header answers for its children', () => {
  afterEach(() => { cleanup() })

  it('adds NOTHING when every child is ready — a healthy page gains no chrome', () => {
    render(page([row('ConfigMap', 'cfg', 'healthy'), row('Service', 'api', 'healthy')]))
    // The composition's own pill, and only it.
    expect(headerPills().filter((text) => text.includes('Ready'))).toEqual(['Ready'])
    expect(childPill()).toBeNull()
  })

  it('reads NotReady when ONE child is not ready, even though the composition itself is Ready', () => {
    render(page([
      row('ConfigMap', 'cfg', 'healthy'),
      row('Deployment', 'payments-api', 'failed'),
      row('Service', 'api', 'healthy'),
    ]))
    const pill = childPill()!
    expect(pill.textContent).toContain('NotReady')
    // WHICH child, and how many: the reader is not left knowing only that something is wrong.
    expect(pill.getAttribute('aria-label')).toBe('1 of 3 children not Ready — NotReady: Deployment/payments-api')
    // And the way to it — the child's own route, so the exception is one click from the header.
    expect(pill.getAttribute('role')).toBe('button')
    expect(pill.getAttribute('tabindex')).toBe('0')
  })

  it('reads NotSynced for a child whose Ready is True but Synced is False', () => {
    render(page([
      row('Deployment', 'drifted', 'healthy', [
        { status: 'True', type: 'Ready' },
        { message: 'values do not validate', reason: 'ReconcileError', status: 'False', type: 'Synced' },
      ]),
    ]))
    // The row's server-resolved state said `healthy` (green); its own conditions say the last
    // reconcile failed. The object wins.
    const pill = childPill()!
    expect(pill.textContent).toContain('NotSynced')
    expect(pill.getAttribute('aria-label')).toContain('ReconcileError')
  })

  it('surfaces an unknown child rather than counting it as health', () => {
    // A managed child the server could not fetch arrives as `pending` (amber), never green.
    render(page([row('Deployment', 'ghost', 'pending')]))
    expect(childPill()?.textContent).toContain('Pending')
  })

  // THE BUG, as installer's detail page on krateo-057 showed it (portal 1.8.125): three managed
  // Secrets the portal deliberately never reads are painted grey ("Unread"), the colour path read
  // grey as `unknown`, and a fully healthy composition opened under "└─ ReadyUnknown · 3 of 137
  // children not Ready — ReadyUnknown: Secret/hyperdx-admin-creds; +2 more".
  describe('a child the chart deliberately does not read', () => {
    const UNREAD_TEMPLATE = {
      ...RELATIONS_TEMPLATE,
      color: { map: { healthy: 'green', unknown: 'gray', unread: 'gray' }, value: '{state}' },
      health: '{health}',
    }
    const unreadPage = (children: unknown[], template: ItemTemplate = UNREAD_TEMPLATE): ReactElement => (
      <MemoryRouter>
        <App>
          <PageHealthProvider>
            <PageHeader
              resourcesRefs={{ items: [] }}
              uid='ph'
              widgetData={{ items: [], tags: [{ color: 'green', label: 'Ready' }], title: 'installer' }}
            />
            <ListView itemTemplate={template} items={children} rowKey='relations' />
          </PageHealthProvider>
        </App>
      </MemoryRouter>
    )
    const healthy = { ...row('Deployment', 'snowplow', 'healthy'), health: 'ready' }
    const secrets = ['hyperdx-admin-creds', 'krateo-registry-image-pull', 'authn-jwt-signing-key']
      .map((name) => ({ ...row('Secret', name, 'unread'), health: 'excluded' }))

    it('control: without a stated health the unread Secrets read as ReadyUnknown', () => {
      const { health: _ignored, ...colourOnly } = UNREAD_TEMPLATE
      render(unreadPage([healthy, ...secrets], colourOnly))
      expect(childPill()?.getAttribute('aria-label'))
        .toBe('3 of 4 children not Ready — ReadyUnknown: Secret/hyperdx-admin-creds; +2 more')
    })

    it('says nothing when the only non-ready rows are excluded', () => {
      render(unreadPage([healthy, ...secrets]))
      expect(childPill()).toBeNull()
      expect(headerPills()).toEqual(['Ready'])
    })

    it('still names a genuinely unknown child beside the excluded ones', () => {
      render(unreadPage([healthy, ...secrets, { ...row('Repo', 'src', 'unknown'), health: 'unknown' }]))
      expect(childPill()?.getAttribute('aria-label'))
        .toBe('1 of 2 children not Ready — ReadyUnknown: Repo/src')
    })
  })

  it('says nothing when the page reports no children at all', () => {
    render(
      <MemoryRouter>
        <App>
          <PageHealthProvider>
            <PageHeader
              resourcesRefs={{ items: [] }}
              uid='ph'
              widgetData={{ items: [], tags: [{ color: 'green', label: 'Ready' }], title: 'payments' }}
            />
          </PageHealthProvider>
        </App>
      </MemoryRouter>,
    )
    expect(headerPills()).toEqual(['Ready'])
  })

  it('does not report from any other list variant — only the composed-children tree', () => {
    render(
      <MemoryRouter>
        <App>
          <PageHealthProvider>
            <PageHeader
              resourcesRefs={{ items: [] }}
              uid='ph'
              widgetData={{ items: [], tags: [{ color: 'green', label: 'Ready' }], title: 'payments' }}
            />
            <ListView
              itemTemplate={{ color: { map: { Warning: 'red' }, value: '{type}' }, primaryText: '{name}' }}
              items={[{ name: 'FailedMount', type: 'Warning' }]}
              rowKey='events'
            />
          </PageHealthProvider>
        </App>
      </MemoryRouter>,
    )
    // An events feed full of warnings is not a statement about the composition's children.
    expect(headerPills()).toEqual(['Ready'])
  })
})
