// @vitest-environment jsdom
/**
 * `direction` and `density` on the architecture variant.
 *
 * THE SNAPSHOT IS MAIN'S. It was recorded from the tree before these fields existed, so a CR that
 * sets neither (every architecture FlowChart published so far: the composition page's diagram)
 * must hand G6 the same options and draw the same cards, and so must one that spells the defaults
 * out (`LR`, `regular`).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'

import { V1B } from './__fixtures__/architecture'
import FlowChart, { type FlowChartData, type FlowChartWidgetData } from './FlowChart'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

const REFS = { items: [] }

/** The options as data: a function is written as the values it gives for every edge drawn. */
const serialise = (options: Record<string, unknown>): string => {
  const edges = ((options.data as { edges?: unknown[] } | undefined)?.edges ?? [])
  return JSON.stringify(options, (key, value: unknown) => {
    if (typeof value !== 'function') { return value }
    if (key === 'component' || key === 'onInit' || key === 'onReady') { return `ƒ ${key}` }
    return { ƒ: key, perEdge: edges.map((edge) => (value as (datum: unknown) => unknown)(edge)) }
  }, 2)
}

/** What the page draws: the options G6 is handed, and the markup of the box with its cards. */
const drawn = (widgetData: FlowChartWidgetData) => {
  render(<FlowChart resourcesRefs={REFS} uid='fc' widgetData={widgetData} />)
  return {
    markup: screen.getByTestId('architecture-graph-box').outerHTML,
    options: serialise(graphDouble.last() as Record<string, unknown>),
  }
}

const architecture = (data: FlowChartData, extra: Record<string, unknown> = {}): FlowChartWidgetData =>
  ({ data, variant: 'architecture', ...extra }) as FlowChartWidgetData

beforeEach(() => {
  graphDouble.reset()
})

afterEach(() => {
  cleanup()
})

describe('FlowChart architecture — LR and regular are main, byte for byte', () => {
  it('draws what main drew when neither field is set', () => {
    const { markup, options } = drawn(architecture(V1B))
    expect(options).toMatchSnapshot('options')
    expect(markup).toMatchSnapshot('markup')
  })
})
