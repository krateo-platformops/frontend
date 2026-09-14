// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import RefChild, { refChildState } from './RefChild'

vi.mock('../WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <div data-testid='rendered'>{widgetEndpoint}</div>,
}))

const refs = (items: { allowed?: boolean; id: string; path?: string }[]): ResourcesRefs =>
  ({ items } as unknown as ResourcesRefs)

// The list a container actually receives: WidgetRenderer has ALREADY filtered allowed:false out,
// and the ids it removed arrive separately. Both fixtures below mirror that shape exactly.
const ALLOWED = refs([{ id: 'good', path: '/widgets/good' }])

describe('RefChild — X4: one visible result for one authoring mistake', () => {
  it('renders the widget when the ref resolves', () => {
    render(<RefChild resourceRefId='good' resourcesRefs={ALLOWED} />)
    expect(screen.getByTestId('rendered').textContent).toBe('/widgets/good')
  })

  it('renders a VISIBLE, ref-NAMING error for a dangling ref — the Tabs contract', () => {
    render(<RefChild label='column' resourceRefId='typo' resourcesRefs={ALLOWED} />)
    expect(screen.getByText(/Error while rendering column/)).toBeTruthy()
    // Naming the id is the whole point: a silent drop sends the author hunting.
    expect(screen.getByText(/resourceRefId: typo/)).toBeTruthy()
  })

  it('renders a COMPACT marker at inline density, not a full Result', () => {
    const { container } = render(
      <RefChild density='inline' label='cell' resourceRefId='typo' resourcesRefs={ALLOWED} />,
    )
    // A Result inside a table cell would destroy row height.
    expect(container.querySelector('.ant-result')).toBeNull()
    expect(container.querySelector('.anticon-warning')).toBeTruthy()
  })
})

describe('RefChild — X2: a denial reads as absence', () => {
  it('renders NOTHING for an RBAC-denied ref, not an error', () => {
    const { container } = render(
      <RefChild deniedRefIds={['secret']} resourceRefId='secret' resourcesRefs={ALLOWED} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('does not leak the denied id into the DOM in any form', () => {
    const { container } = render(
      <RefChild deniedRefIds={['secret']} resourceRefId='secret' resourcesRefs={ALLOWED} />,
    )
    expect(container.innerHTML).not.toContain('secret')
  })

  it('stays silent at inline density too — density must not change the disclosure decision', () => {
    const { container } = render(
      <RefChild deniedRefIds={['secret']} density='inline' resourceRefId='secret' resourcesRefs={ALLOWED} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('refChildState — what Row needs to know before it renders a column', () => {
  it('reports ok for a resolvable ref', () => {
    expect(refChildState('good', ALLOWED)).toBe('ok')
  })

  it('reports denied ONLY when the id is in the denied list', () => {
    expect(refChildState('secret', ALLOWED, ['secret'])).toBe('denied')
  })

  it('reports dangling for an unknown id with no denial recorded', () => {
    expect(refChildState('typo', ALLOWED, ['secret'])).toBe('dangling')
  })

  it('treats an absent denied list as "nothing was denied", never as "everything was"', () => {
    expect(refChildState('typo', ALLOWED)).toBe('dangling')
  })
})
