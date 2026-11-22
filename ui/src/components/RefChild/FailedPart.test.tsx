// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const raiseSessionExpired = vi.fn<() => Promise<'logout' | 'resumed'>>()
vi.mock('../../utils/sessionResume', () => ({ raiseSessionExpired: () => raiseSessionExpired() }))

import { ParentRefetchContext } from '../../context/ParentRefetchContext'
import type { RefFailure, ResourcesRefs } from '../../types/Widget'

import { failureKind } from './FailedPart'
import { partitionRefs } from './partitionRefs'
import RefChild, { refChildState } from './RefChild'

vi.mock('../WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <div data-testid='rendered'>{widgetEndpoint}</div>,
}))

// snowplow 1.12.75's failure shapes (resourcesrefs/failed.go), as snowplow described them.
const TYPE_NOT_INSTALLED: RefFailure = {
  code: 424,
  details: { causes: [{ field: 'apiVersion', message: 'widgets.templates.krateo.io/v1beta1', reason: 'TypeNotInstalled' }], group: 'widgets.templates.krateo.io', kind: 'menus' },
  kind: 'Status',
  message: 'The type menus (widgets.templates.krateo.io/v1beta1) is not installed on this cluster.',
  reason: 'FailedDependency',
  status: 'Failure',
}
const BARE_500: RefFailure = { code: 500, kind: 'Status', message: 'The type menus (widgets.templates.krateo.io/v1beta1) could not be looked up.', reason: 'InternalError', status: 'Failure' }
const THROTTLED: RefFailure = { code: 429, kind: 'Status', message: 'The type menus could not be looked up.', reason: 'TooManyRequests', status: 'Failure' }

// A lookup snowplow sent with discovery's own code (#1576 DiscoveryFailed): the credential refused, or refused access.
const REFUSED_401: RefFailure = { code: 401, details: { causes: [{ reason: 'DiscoveryFailed' }] }, kind: 'Status', message: 'The type menus could not be looked up: Unauthorized.', reason: 'Unauthorized', status: 'Failure' }
const REFUSED_403: RefFailure = { code: 403, details: { causes: [{ reason: 'DiscoveryFailed' }] }, kind: 'Status', message: 'The type menus could not be looked up: Forbidden.', reason: 'Forbidden', status: 'Failure' }

const NONE: ResourcesRefs = { items: [] }

afterEach(() => {
  cleanup()
  raiseSessionExpired.mockReset()
})

describe('failureKind: keyed on snowplow\'s structured cause, never its message', () => {
  it('a type not installed is permanent (424, or the TypeNotInstalled cause)', () => {
    expect(failureKind(TYPE_NOT_INSTALLED)).toBe('permanent')
    expect(failureKind({ ...TYPE_NOT_INSTALLED, code: undefined })).toBe('permanent')
  })

  it('an APIVersionInvalid cause (snowplow #1576) is permanent; DiscoveryFailed is transient', () => {
    expect(failureKind({ ...BARE_500, details: { causes: [{ reason: 'APIVersionInvalid' }] } })).toBe('permanent')
    expect(failureKind({ ...BARE_500, details: { causes: [{ reason: 'DiscoveryFailed' }] } })).toBe('transient')
  })

  it('a bare 500 is transient until snowplow names its cause; the cluster\'s own codes are transient', () => {
    expect(failureKind(BARE_500)).toBe('transient')
    expect(failureKind(THROTTLED)).toBe('transient')
  })
})

describe('failureKind: the part\'s own 401 and 403 are never retried', () => {
  it('401 asks to sign in again; 403 is permanent; both whatever the cause says', () => {
    expect(failureKind(REFUSED_401)).toBe('signin')
    expect(failureKind(REFUSED_403)).toBe('permanent')
    expect(failureKind({ ...REFUSED_403, details: undefined })).toBe('permanent')
  })
})

describe('partitionRefs: a denial stays hidden, a failure is shown', () => {
  it('splits allowed:false by whether snowplow gave an error', () => {
    const split = partitionRefs({ items: [
      { allowed: true, id: 'ok', path: '/x', payload: {}, verb: 'GET' },
      { allowed: false, id: 'denied', path: '', payload: {}, verb: 'GET' },
      { allowed: false, error: TYPE_NOT_INSTALLED, id: 'sider', path: '', payload: {}, verb: 'GET' },
    ] })
    expect(split.deniedRefIds).toEqual(['denied'])
    expect(split.failedRefs).toEqual({ sider: TYPE_NOT_INSTALLED })
  })
})

describe('RefChild with a failed part', () => {
  it('a permanent failure: snowplow\'s message and who can fix it, and no retry', () => {
    render(<RefChild failedRefs={{ sider: TYPE_NOT_INSTALLED }} resourceRefId='sider' resourcesRefs={NONE} />)
    expect(screen.getByText(TYPE_NOT_INSTALLED.message!)).toBeTruthy()
    expect(screen.getByText(/ask a platform admin to install it/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('a transient failure: the message and Try again, which re-reads the parent', () => {
    const refetch = vi.fn()
    render(
      <ParentRefetchContext.Provider value={refetch}>
        <RefChild failedRefs={{ strip: BARE_500 }} resourceRefId='strip' resourcesRefs={NONE} />
      </ParentRefetchContext.Provider>,
    )
    expect(screen.getByText(BARE_500.message!)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('a 403: who can fix it, and no retry', () => {
    render(<RefChild failedRefs={{ nav: REFUSED_403 }} resourceRefId='nav' resourcesRefs={NONE} />)
    expect(screen.getByText(/403 · you don’t have access to look this up: ask a platform admin/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a 401: Sign in again opens the session-expired flow, and re-reads the parent only once resumed', async () => {
    const refetch = vi.fn()
    const view = (failure: RefFailure) => render(
      <ParentRefetchContext.Provider value={refetch}>
        <RefChild failedRefs={{ nav: failure }} resourceRefId='nav' resourcesRefs={NONE} />
      </ParentRefetchContext.Provider>,
    )
    raiseSessionExpired.mockResolvedValueOnce('logout')
    const first = view(REFUSED_401)
    expect(screen.getByText('Your sign-in wasn’t accepted for this part')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }))
    await vi.waitFor(() => { expect(raiseSessionExpired).toHaveBeenCalledOnce() })
    expect(refetch).not.toHaveBeenCalled()
    first.unmount()
    raiseSessionExpired.mockResolvedValueOnce('resumed')
    view(REFUSED_401)
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }))
    await vi.waitFor(() => { expect(refetch).toHaveBeenCalledOnce() })
  })

  it('a denied ref still renders nothing, even with other parts failed', () => {
    const { container } = render(<RefChild deniedRefIds={['denied']} failedRefs={{ sider: TYPE_NOT_INSTALLED }} resourceRefId='denied' resourcesRefs={NONE} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps its slot: refChildState says failed, not denied (Row keeps the column)', () => {
    expect(refChildState('sider', NONE, [], { sider: TYPE_NOT_INSTALLED })).toBe('failed')
    expect(refChildState('denied', NONE, ['denied'], { sider: TYPE_NOT_INSTALLED })).toBe('denied')
  })
})
