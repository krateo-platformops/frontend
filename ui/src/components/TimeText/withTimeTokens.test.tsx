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
import PageHeader from '../../widgets/PageHeader/PageHeader'
import Paragraph from '../../widgets/Paragraph/Paragraph'

import { withTimeTokens } from './withTimeTokens'

vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal<object>()), useNavigate: () => vi.fn() }))

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

  it('PageHeader subtitle', () => {
    render(<PageHeader resourcesRefs={{ items: [] }} uid='h' widgetData={{ subtitle: 'Composition · demo · created {ago:2026-11-22T15:00:00Z}', title: 'acme' }} />)
    expect(screen.getByText('3 days ago').tagName).toBe('TIME')
  })
})
