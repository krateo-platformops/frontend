// @vitest-environment jsdom
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Segmented from './Segmented'
import type { SegmentedWidgetData } from './Segmented'

afterEach(cleanup)

// The app registers the icon packs at bootstrap (App.tsx); a unit render has to do it itself.
library.add(fas)

// antd's Segmented measures its thumb; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
})

let search = ''
const Where = () => {
  search = useLocation().search
  return null
}

const RANGE: SegmentedWidgetData = {
  ariaLabel: 'Time range',
  options: [{ value: '1h' }, { value: '6h' }, { label: 'Last day', value: '24h' }],
  queryParam: 'range',
}

const renderSegmented = (widgetData: SegmentedWidgetData, url = '/page') => render(
  <MemoryRouter initialEntries={[url]}>
    <Segmented resourcesRefs={{ items: [] }} uid='s' widget={{} as never} widgetData={widgetData} />
    <Where />
  </MemoryRouter>,
).container

// antd's radio inputs carry no value; the segment's text is what the reader sees selected.
const checked = () => screen.getAllByRole<HTMLInputElement>('radio')
  .filter((input) => input.checked)
  .map((input) => input.closest('label')?.textContent)

describe('Segmented widget', () => {
  it('shows the first option while the URL has no param', () => {
    renderSegmented(RANGE)
    expect(checked()).toEqual(['1h'])
  })

  it('shows `defaultValue` while the URL has no param', () => {
    renderSegmented({ ...RANGE, defaultValue: '6h' })
    expect(checked()).toEqual(['6h'])
  })

  it('reads the choice from the URL', () => {
    renderSegmented(RANGE, '/page?range=24h')
    expect(checked()).toEqual(['Last day'])
  })

  it('writes the choice to the URL and keeps every other param', () => {
    renderSegmented(RANGE, '/page?status=open')
    fireEvent.click(screen.getByText('6h'))
    expect(new URLSearchParams(search).get('range')).toBe('6h')
    expect(new URLSearchParams(search).get('status')).toBe('open')
  })

  it('removes the param when the default is chosen, so the plain address stays the default', () => {
    renderSegmented(RANGE, '/page?range=6h&status=open')
    fireEvent.click(screen.getByText('1h'))
    expect(search).toBe('?status=open')
  })

  it('selects no segment for a URL value no option names', () => {
    renderSegmented(RANGE, '/page?range=7d')
    expect(checked()).toEqual([])
  })

  it('names the group for a screen reader', () => {
    const container = renderSegmented(RANGE)
    expect(container.querySelector('[aria-label="Time range"]')).toBeTruthy()
  })

  it('names an icon-only segment by its tooltip', () => {
    renderSegmented({
      options: [{ icon: 'fa-table', label: '', tooltip: 'Table', value: 'table' }, { icon: 'fa-diagram-project', label: '', tooltip: 'Graph', value: 'graph' }],
      queryParam: 'view',
    })
    expect(screen.getByRole('img', { name: 'Graph' })).toBeTruthy()
  })

  it('does not let a disabled segment be chosen', () => {
    renderSegmented({ ...RANGE, options: [{ value: '1h' }, { disabled: true, value: '6h' }] })
    fireEvent.click(screen.getByText('6h'))
    expect(search).toBe('')
  })
})
