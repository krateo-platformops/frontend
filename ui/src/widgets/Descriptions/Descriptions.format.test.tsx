// @vitest-environment jsdom
/**
 * An item's `format`: the RESTAction sends the ISO time and the item writes it in one of the approved
 * forms ("Dates and ages", 2026-11-24) in the viewer's zone, full date on hover. Without `format`, the value
 * is shown as it came, as before the field existed.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatMoment } from '../../utils/dateFormat'

import Descriptions from './Descriptions'
import type { DescriptionsWidgetData } from './Descriptions'

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
})
const NOW = Date.parse('2026-11-25T15:00:00Z')
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const CREATED = '2026-10-07T09:00:00Z'
const view = (items: DescriptionsWidgetData['items'], variant?: 'form') => render(
  <MemoryRouter>
    <Descriptions resourcesRefs={{ items: [] }} uid='d1' widgetData={{ items, ...(variant ? { variant } : {}) }} />
  </MemoryRouter>,
)

describe('Descriptions item format', () => {
  it('age, ago and moment, each a <time> with the instant', () => {
    view([
      { format: 'age', label: 'Age', value: CREATED },
      { format: 'ago', label: 'Updated', value: '2026-11-25T14:08:00Z' },
      { format: 'moment', label: 'Created', value: CREATED },
    ])
    expect(screen.getByText('7 weeks').tagName).toBe('TIME')
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
    expect(screen.getByText(formatMoment(CREATED)).getAttribute('dateTime')).toBe('2026-10-07T09:00:00.000Z')
  })

  it('the form variant writes it the same way', () => {
    view([{ format: 'age', label: 'Age', value: CREATED }], 'form')
    expect(screen.getByText('7 weeks').tagName).toBe('TIME')
  })

  it('a time inside a link stays a link', () => {
    view([{ format: 'ago', href: '/compositions/ns/x', label: 'Last run', value: '2026-11-25T14:08:00Z' }])
    expect(screen.getByRole('link', { name: '52 minutes ago' }).getAttribute('href')).toBe('/compositions/ns/x')
  })

  it('without format, or with a value that is not a time, the value is shown as it came', () => {
    view([{ label: 'Created', value: CREATED }, { format: 'age', label: 'Age', value: '49d ago' }])
    expect(screen.getByText(CREATED).tagName).not.toBe('TIME')
    expect(screen.getByText('49d ago').tagName).toBe('SPAN')
  })
})
