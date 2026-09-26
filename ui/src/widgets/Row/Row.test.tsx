// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import Row from './Row'
import type { RowWidgetData } from './Row'

vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <div data-testid='rendered'>{widgetEndpoint}</div>,
}))

// The list a container actually receives: WidgetRenderer has ALREADY filtered allowed:false
// out, and the ids it removed arrive separately in deniedRefIds. So a DENIED ref is ABSENT
// from resourcesRefs and present in deniedRefIds; a DANGLING one is absent from both. Getting
// this shape wrong makes a denied ref resolve as 'ok' and the test silently prove nothing.
const refs = (ids: string[]): ResourcesRefs =>
  ({ items: ids.map((id) => ({ id, path: `/widgets/${id}` })) } as unknown as ResourcesRefs)

const rowOf = (resourceRefIds: string[]): RowWidgetData =>
  ({ items: resourceRefIds.map((resourceRefId) => ({ resourceRefId })) } as RowWidgetData)

const spans = (container: HTMLElement) =>
  [...container.querySelectorAll('[class*="ant-col-"]')]
    .map((el) => Number(/ant-col-(\d+)/.exec(el.className)?.[1]))
    .filter((span) => !Number.isNaN(span))

const FOUR = ['a', 'b', 'c', 'd']

beforeAll(() => {
  // antd + jsdom compatibility shim, same shape the other widget suites use: antd's Grid
  // calls useBreakpoint -> responsiveObserver, which needs matchMedia. jsdom has none.
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
})

describe('Row — X8: layout maths runs on the children that survive', () => {
  it('splits the row evenly when every child resolves — the baseline that must not move', () => {
    const { container } = render(
      <Row resourcesRefs={refs(FOUR)} uid='r' widgetData={rowOf(FOUR)} />,
    )
    expect(spans(container)).toEqual([6, 6, 6, 6])
  })

  it('redistributes the survivors when a ref is DENIED, leaving no dead grid space', () => {
    // The regression. Before the fix this rendered three span-6 columns — 18 of 24 units —
    // and a 6-unit hole on the right, because the denominator counted the dropped child.
    const { container } = render(
      <Row deniedRefIds={['b']} resourcesRefs={refs(['a', 'c', 'd'])} uid='r' widgetData={rowOf(FOUR)} />,
    )
    const got = spans(container)
    expect(got).toHaveLength(3)
    expect(got).toEqual([8, 8, 8])
    expect(got.reduce((sum, span) => sum + span, 0)).toBe(24)
  })

  it('still COUNTS a dangling ref, which keeps its column — the X4 contract', () => {
    // X4 deliberately keeps a dangling child's column so the grid does not reflow around the
    // visible error. If a future edit filters dangling refs too, this fails.
    const { container } = render(
      <Row resourcesRefs={refs(['a', 'c', 'd'])} uid='r' widgetData={rowOf(FOUR)} />,
    )
    expect(spans(container)).toEqual([6, 6, 6, 6])
  })

  it('lets an explicit size win over the computed default', () => {
    const widgetData = { items: [{ resourceRefId: 'a', size: 12 }, { resourceRefId: 'b' }] } as RowWidgetData
    const { container } = render(
      <Row resourcesRefs={refs(['a', 'b'])} uid='r' widgetData={widgetData} />,
    )
    expect(spans(container)).toEqual([12, 12])
  })

  it('keeps surviving children on their AUTHORED index so a denial does not remount them', () => {
    // Keys are index-derived. If the fix had mapped the filtered array's own index, every
    // survivor after the denial would get a new key — a remount, hence a refetch, and for a
    // Form child that is the dirty-state wipe.
    const { container } = render(
      <Row deniedRefIds={['a']} resourcesRefs={refs(['b', 'c', 'd'])} uid='r' widgetData={rowOf(FOUR)} />,
    )
    const rendered = [...container.querySelectorAll('[data-testid="rendered"]')].map((el) => el.textContent)
    expect(rendered).toEqual(['/widgets/b', '/widgets/c', '/widgets/d'])
  })
})

describe('Row — a row with nothing to show is not there', () => {
  it('renders nothing for zero items: a template that resolves `items` to [] hides the section', () => {
    // The composition detail page's topology row, for a composition without an architecture. An
    // empty <div> here was one more gap in the page's vertical Flex.
    const { container } = render(<Row resourcesRefs={refs([])} uid='r' widgetData={rowOf([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when every item is denied — absence, not a hole (X2)', () => {
    const { container } = render(
      <Row deniedRefIds={FOUR} resourcesRefs={refs([])} uid='r' widgetData={rowOf(FOUR)} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('still renders a row whose only item is dangling — X4 keeps its visible error', () => {
    const { container } = render(<Row resourcesRefs={refs([])} uid='r' widgetData={rowOf(['typo'])} />)
    expect(spans(container)).toEqual([24])
  })
})
