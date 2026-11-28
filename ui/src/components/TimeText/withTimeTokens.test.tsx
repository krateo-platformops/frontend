// @vitest-environment jsdom
/**
 * Time tokens in widget text ("… created {ago:2026-11-04T10:10:27Z}"), written by the browser in the
 * viewer's zone with the full date on hover, for Paragraph text and the PageHeader subtitle. A jq-computed
 * "3d ago" is frozen in snowplow's cache and in UTC; a token is neither. Text without a token is the very
 * string it was.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatMoment } from '../../utils/dateFormat'
import Alert from '../../widgets/Alert/Alert'
import Card from '../../widgets/Card/Card'
import PageHeader from '../../widgets/PageHeader/PageHeader'
import Paragraph from '../../widgets/Paragraph/Paragraph'
import Tag from '../../widgets/Tag/Tag'

import { withTimeTokens } from './withTimeTokens'

vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal<object>()), useNavigate: () => vi.fn() }))
vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }) }))

const NOW = Date.parse('2026-11-25T15:00:00Z')
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('withTimeTokens', () => {
  it('text without a token is the very same string', () => {
    expect(withTimeTokens('Composition · ns · created 3d ago')).toBe('Composition · ns · created 3d ago')
    expect(withTimeTokens('{localTimeOfDay}')).toBe('{localTimeOfDay}')
    expect(withTimeTokens(undefined)).toBeUndefined()
  })

  it('each form, inside a sentence, as a <time>', () => {
    const { container } = render(<p>{withTimeTokens('created {ago:2026-11-25T14:08:00Z}, {age:2026-10-07T15:00:00Z} old, last {moment:2026-11-04T10:10:27Z} on {date:2026-09-18}')}</p>)
    expect(container.textContent).toBe(`created 52 minutes ago, 7 weeks old, last ${formatMoment('2026-11-04T10:10:27Z')} on 18 Sep`)
    expect(container.querySelectorAll('time')).toHaveLength(4)
  })

  it('a token whose time does not parse stays as written', () => {
    expect(withTimeTokens('since {ago:2026-13-45T99:99:99Z}')).toBe('since {ago:2026-13-45T99:99:99Z}')
  })
})

describe('in the widgets that write text', () => {
  it('Paragraph text', () => {
    render(<Paragraph resourcesRefs={{ items: [] }} uid='p' widgetData={{ text: 'Paused {ago:2026-11-25T14:08:00Z}' }} />)
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
  })

  it('Alert title and description', () => {
    render(<Alert resourcesRefs={{ items: [] }} uid='a' widgetData={{ description: 'The portal last read it {ago:2026-11-25T14:08:00Z}.', title: 'Firing since {age:2026-11-22T15:00:00Z}' }} />)
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
    expect(screen.getByText('3 days').tagName).toBe('TIME')
  })

  it('Tag label, and a state word keeps its glyph', () => {
    const { container } = render(<><Tag resourcesRefs={{ items: [] }} uid='t' widgetData={{ color: 'orange', label: 'since {moment:2026-11-14T08:22:00Z}' }} /><Tag resourcesRefs={{ items: [] }} uid='r' widgetData={{ color: 'green', label: 'Ready' }} /></>)
    expect(screen.getByText(formatMoment('2026-11-14T08:22:00Z')).tagName).toBe('TIME')
    expect(container.querySelectorAll('[data-state-family]')).toHaveLength(1)
  })

  it('Card extra, plain and as a pill', () => {
    render(<Card resourcesRefs={{ items: [] }} uid='c' widget={{} as never} widgetData={{ extra: '101 drafts · {date:2026-09-16T10:00:00Z}–{date:2026-09-24T10:00:00Z}', items: [], title: 'Drafts' }} />)
    expect(screen.getByText('16 Sep').tagName).toBe('TIME')
    cleanup()
    render(<Card resourcesRefs={{ items: [] }} uid='c' widget={{} as never} widgetData={{ extra: 'since {ago:2026-11-25T14:08:00Z}', extraVariant: 'tag', items: [], title: 'Run' }} />)
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
  })

  it('without a token, the same text and no <time> in each of them', () => {
    const { container } = render(
      <>
        <Alert resourcesRefs={{ items: [] }} uid='a' widgetData={{ description: 'Started 2026-11-04 10:10 UTC', title: 'Banner' }} />
        <Tag resourcesRefs={{ items: [] }} uid='t' widgetData={{ label: 'since 2026-11-14 08:22 UTC' }} />
        <Card resourcesRefs={{ items: [] }} uid='c' widget={{} as never} widgetData={{ extra: 'per 5 minutes · UTC', items: [], title: 'X' }} />
      </>,
    )
    expect(container.querySelectorAll('time')).toHaveLength(0)
    expect(container.textContent).toContain('Started 2026-11-04 10:10 UTC')
    expect(container.textContent).toContain('since 2026-11-14 08:22 UTC')
    expect(container.textContent).toContain('per 5 minutes · UTC')
  })

  it('PageHeader subtitle', () => {
    render(<PageHeader resourcesRefs={{ items: [] }} uid='h' widgetData={{ subtitle: 'Composition · demo · created {ago:2026-11-22T15:00:00Z}', title: 'acme' }} />)
    expect(screen.getByText('3 days ago').tagName).toBe('TIME')
  })
})
