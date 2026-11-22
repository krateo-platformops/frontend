// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

const NONE: ResourcesRefs = { items: [] }

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

  it('a denied ref still renders nothing, even with other parts failed', () => {
    const { container } = render(<RefChild deniedRefIds={['denied']} failedRefs={{ sider: TYPE_NOT_INSTALLED }} resourceRefId='denied' resourcesRefs={NONE} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps its slot: refChildState says failed, not denied (Row keeps the column)', () => {
    expect(refChildState('sider', NONE, [], { sider: TYPE_NOT_INSTALLED })).toBe('failed')
    expect(refChildState('denied', NONE, ['denied'], { sider: TYPE_NOT_INSTALLED })).toBe('denied')
  })
})
