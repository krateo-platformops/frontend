// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ResourcesRefs } from '../../types/Widget'

import Splitter, { toCollapsible } from './Splitter'
import type { SplitterWidgetData } from './Splitter'

// A panel's body is a WidgetRenderer, which would fetch: stub it with the endpoint it was handed.
vi.mock('../../components/WidgetRenderer', () => ({
  default: ({ widgetEndpoint }: { widgetEndpoint: string }) => <div data-testid='child'>{widgetEndpoint}</div>,
}))

afterEach(cleanup)

// antd's Splitter measures its container; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

const ref = (id: string) => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1', id, name: id, namespace: 'krateo-system', path: `/call?name=${id}`, resource: 'paragraphs', verb: 'GET' as const,
})
const REFS = { items: [ref('left'), ref('right')] } as unknown as ResourcesRefs

const renderSplitter = (widgetData: Partial<SplitterWidgetData>, extra: { deniedRefIds?: string[]; resourcesRefs?: ResourcesRefs } = {}) => render(
  <Splitter
    deniedRefIds={extra.deniedRefIds}
    resourcesRefs={extra.resourcesRefs ?? REFS}
    uid='s'
    widget={{} as never}
    widgetData={{ allowedResources: ['paragraphs'], items: [{ resourceRefId: 'left' }, { resourceRefId: 'right' }], ...widgetData }}
  />,
).container

describe('Splitter widget', () => {
  it('draws each panel\'s child widget, in order', () => {
    renderSplitter({})
    expect(screen.getAllByTestId('child').map((child) => child.textContent)).toEqual(['/call?name=left', '/call?name=right'])
  })

  it('puts a bar between the panels', () => {
    const container = renderSplitter({})
    expect(container.querySelectorAll('.ant-splitter-panel')).toHaveLength(2)
    expect(container.querySelectorAll('.ant-splitter-bar')).toHaveLength(1)
  })

  it('stacks the panels when vertical, at the given height', () => {
    const container = renderSplitter({ height: 320, orientation: 'vertical' })
    const root = container.querySelector<HTMLElement>('.ant-splitter')
    expect(root?.className).toContain('ant-splitter-vertical')
    expect(root?.style.height).toBe('320px')
  })

  it('starts a panel at its defaultSize', () => {
    const container = renderSplitter({ items: [{ defaultSize: '25%', resourceRefId: 'left' }, { resourceRefId: 'right' }] })
    expect(container.querySelector<HTMLElement>('.ant-splitter-panel')?.style.flexBasis).toBe('25%')
  })

  it('says so in the panel when its ref does not resolve', () => {
    renderSplitter({ items: [{ resourceRefId: 'left' }, { resourceRefId: 'missing' }] })
    expect(screen.getAllByTestId('child')).toHaveLength(1)
    expect(screen.getByText(/missing/)).toBeTruthy()
  })

  it('drops a panel whose ref the caller may not read, leaving no trace', () => {
    const container = renderSplitter({}, { deniedRefIds: ['right'], resourcesRefs: { items: [ref('left')] } as unknown as ResourcesRefs })
    expect(container.querySelectorAll('.ant-splitter-panel')).toHaveLength(1)
    expect(container.querySelector('.ant-splitter-bar')).toBeNull()
  })

  it('maps the folding edge to antd\'s collapsible', () => {
    expect(toCollapsible(undefined)).toBeUndefined()
    expect(toCollapsible('start')).toEqual({ start: true })
    expect(toCollapsible('end')).toEqual({ end: true })
    expect(toCollapsible('both')).toBe(true)
  })
})
