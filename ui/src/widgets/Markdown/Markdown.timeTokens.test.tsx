// @vitest-environment jsdom
/**
 * Time tokens in Markdown (`{ago:<ISO>}`…, the same tokens and tokenizer as Paragraph and PageHeader,
 * utils/timeTokens): the incident fix steps read "**Last run:** still holds · since 2026-10-09 09:47 UTC",
 * a UTC stamp written in jq. A token is written in the browser, in the viewer's zone, full date on hover.
 * Inside code it stays literal; markdown without one renders exactly as before.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatMoment } from '../../utils/dateFormat'

import Markdown from './Markdown'

const NOW = Date.parse('2026-11-25T15:00:00Z')
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const view = (markdown: string, extra: Record<string, unknown> = {}) => render(
  <MemoryRouter>
    <Markdown resourcesRefs={{ items: [] }} uid='m1' widget={{} as never} widgetData={{ markdown, ...extra }} />
  </MemoryRouter>,
).container

describe('Markdown time tokens', () => {
  it('a token in a sentence, in bold, in a list and in a table cell: a <time> in its form', () => {
    const container = view([
      '**Last run:** still holds · since {moment:2026-10-09T09:47:00Z}',
      '',
      '- applied {ago:2026-11-25T14:08:00Z}',
      '',
      '| when | what |',
      '| --- | --- |',
      '| {age:2026-10-07T15:00:00Z} | **{ago:2026-11-25T14:55:00Z}** |',
    ].join('\n'))
    expect(screen.getByText(formatMoment('2026-10-09T09:47:00Z')).tagName).toBe('TIME')
    expect(screen.getByText('52 minutes ago').tagName).toBe('TIME')
    expect(screen.getByText('7 weeks').closest('td')).not.toBeNull()
    expect(screen.getByText('5 minutes ago').closest('strong')).not.toBeNull()
    expect(container.querySelectorAll('time')).toHaveLength(4)
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-09T09:47:00.000Z')
  })

  it('inside inline code or a fenced block, a token stays as written', () => {
    const container = view('run `echo {ago:2026-11-25T14:08:00Z}`\n\n```\n{ago:2026-11-25T14:08:00Z}\n```')
    expect(container.querySelectorAll('time')).toHaveLength(0)
    expect(container.textContent).toContain('echo {ago:2026-11-25T14:08:00Z}')
  })

  it('a token inside a link stays inside the link', () => {
    view('[merged {ago:2026-11-25T14:08:00Z}](https://example.com/pr/1)')
    expect(screen.getByRole('link', { name: 'merged 52 minutes ago' }).getAttribute('href')).toBe('https://example.com/pr/1')
  })

  it('a download carries every token as its words, code included; without a token, the source as written', () => {
    // jsdom's Blob cannot be read back, so the parts it is built from are what is read.
    const written: unknown[] = []
    vi.stubGlobal('Blob', vi.fn(function capture(parts: unknown[]) { written.push(parts.join('')) }))
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    view('applied {ago:2026-11-25T14:08:00Z}, `{ago:2026-11-25T14:08:00Z}`', { allowDownload: true })
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    cleanup()
    view('since 2026-10-09 09:47 UTC', { allowDownload: true })
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    vi.unstubAllGlobals()
    expect(written).toEqual(['applied 52 minutes ago, `52 minutes ago`', 'since 2026-10-09 09:47 UTC'])
  })

  it('markdown without a token: no <time>, the same DOM', () => {
    const plain = '**Last run:** still holds · since 2026-10-09 09:47 UTC {notAToken}'
    const container = view(plain)
    expect(container.querySelectorAll('time')).toHaveLength(0)
    expect(container.textContent).toContain(plain.replace(/\*\*/g, ''))
  })
})
