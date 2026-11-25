/**
 * Dates and ages (approved design "Dates and ages", 2026-11-24; audit TIME-1, TIME-2). Every case pins
 * the clock and the zone: the same instant is written for a viewer in Rome and one in New York, so a
 * formatter that ignored the viewer's zone (the server's UTC strftime did) fails here.
 */
import { describe, expect, it } from 'vitest'

import { formatAge, formatAgo, formatClock, formatDate, formatFull, formatMoment, formatTime, timeFormOf, toInstant } from './dateFormat'

/** Wed 25 Nov 2026, 15:00:00 UTC: 16:00 in Rome (UTC+1), 10:00 in New York (UTC-5). */
const NOW = Date.parse('2026-11-25T15:00:00Z')
const ROME = { now: NOW, timeZone: 'Europe/Rome' }
const NEW_YORK = { now: NOW, timeZone: 'America/New_York' }
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString()
const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('age, in a column', () => {
  it.each([
    [0, 'just now'],
    [59, 'just now'],
    [60, '1 minute'],
    [2 * MIN, '2 minutes'],
    [59 * MIN + 59, '59 minutes'],
    [HOUR, '1 hour'],
    [23 * HOUR + 59 * MIN, '23 hours'],
    [DAY, '1 day'],
    [6 * DAY + 23 * HOUR, '6 days'],
    [7 * DAY, '1 week'],
    [49 * DAY, '7 weeks'],
    [59 * DAY, '8 weeks'],
    [60 * DAY, '2 months'],
    [364 * DAY, '11 months'],
    [365 * DAY, '1 year'],
    [3 * 365 * DAY, '3 years'],
  ])('%i seconds old is "%s"', (seconds, text) => {
    expect(formatAge(ago(seconds), ROME)).toBe(text)
  })

  it('a time still to come is never a negative age', () => {
    expect(formatAge(ago(-3 * HOUR), ROME)).toBe('in 3 hours')
    expect(formatAge(ago(-30), ROME)).toBe('just now')
  })

  it('does not depend on the zone', () => {
    expect(formatAge(ago(49 * DAY), NEW_YORK)).toBe(formatAge(ago(49 * DAY), ROME))
  })
})

describe('ago, in a sentence', () => {
  it.each([
    [10, 'just now'],
    [MIN, '1 minute ago'],
    [52 * MIN, '52 minutes ago'],
    [DAY, '1 day ago'],
    [26 * DAY, '3 weeks ago'],
    [400 * DAY, '1 year ago'],
  ])('%i seconds ago is "%s"', (seconds, text) => {
    expect(formatAgo(ago(seconds), ROME)).toBe(text)
  })

  it('a time still to come says so', () => {
    expect(formatAgo(ago(-2 * DAY), ROME)).toBe('in 2 days')
  })
})

describe('a moment, in the viewer’s zone', () => {
  it('this year: day, month and the clock', () => {
    expect(formatMoment('2026-11-04T10:10:27Z', ROME)).toBe('4 Nov, 11:10')
    expect(formatMoment('2026-11-04T10:10:27Z', NEW_YORK)).toBe('4 Nov, 05:10')
  })

  it('another year: the year as well', () => {
    expect(formatMoment('2025-09-10T07:30:00Z', ROME)).toBe('10 Sep 2025, 09:30')
  })

  it('the year is the viewer’s: on 1 January a New Year’s Eve evening is last year', () => {
    // 06:00 UTC on 1 Jan 2027 is 01:00 that day in New York; 02:00 UTC was 21:00 on 31 Dec there.
    const newYear = { now: Date.parse('2027-01-01T06:00:00Z') }
    expect(formatMoment('2027-01-01T02:00:00Z', { ...newYear, timeZone: 'Europe/Rome' })).toBe('1 Jan, 03:00')
    expect(formatMoment('2027-01-01T02:00:00Z', { ...newYear, timeZone: 'America/New_York' })).toBe('31 Dec 2026, 21:00')
  })

  it('midnight is 00:00, never 24:00', () => {
    expect(formatClock('2026-11-24T23:00:00Z', ROME)).toBe('00:00')
  })

  it('a raw RFC3339 stamp, nanoseconds included, is never shown as is', () => {
    expect(formatMoment('2026-10-06T04:35:04.158732159Z', ROME)).toBe('6 Oct, 06:35')
    expect(formatMoment('2026-08-24T15:55:48Z', NEW_YORK)).toBe('24 Aug, 11:55')
  })

  it('a calendar day stays that day in every zone', () => {
    expect(formatMoment('2026-09-18', NEW_YORK)).toBe('18 Sep')
    expect(formatDate('2026-09-18', NEW_YORK)).toBe('18 Sep')
    expect(formatDate('2025-09-18', ROME)).toBe('18 Sep 2025')
  })
})

describe('the full date, on hover', () => {
  it('weekday, date, seconds and the offset, in the viewer’s zone', () => {
    expect(formatFull('2026-11-04T10:10:27Z', ROME)).toBe('Wed 4 November 2026, 11:10:27 (UTC+1)')
    expect(formatFull('2026-11-04T10:10:27Z', NEW_YORK)).toBe('Wed 4 November 2026, 05:10:27 (UTC-5)')
  })

  it('the offset follows daylight saving and half-hour zones', () => {
    expect(formatFull('2026-07-04T10:10:27Z', ROME)).toBe('Sat 4 July 2026, 12:10:27 (UTC+2)')
    expect(formatFull('2026-11-04T10:10:27Z', { timeZone: 'Asia/Kolkata' })).toBe('Wed 4 November 2026, 15:40:27 (UTC+5:30)')
    expect(formatFull('2026-11-04T10:10:27Z', { timeZone: 'UTC' })).toBe('Wed 4 November 2026, 10:10:27 (UTC)')
  })

  it('a calendar day is the day alone', () => {
    expect(formatFull('2026-09-18', NEW_YORK)).toBe('Fri 18 September 2026')
  })
})

describe('what is not a time', () => {
  it('is returned as it came, never reparsed: Date.parse would read "5" as a year', () => {
    expect(toInstant('5')).toBeUndefined()
    expect(formatAge('5', ROME)).toBe('5')
    expect(formatMoment('3 days ago', ROME)).toBe('3 days ago')
    expect(formatFull('soon', ROME)).toBe('')
  })

  it('a Date and an epoch in milliseconds are times', () => {
    expect(formatMoment(new Date('2026-11-04T10:10:00Z'), ROME)).toBe('4 Nov, 11:10')
    expect(formatMoment(Date.parse('2026-11-04T10:10:00Z'), ROME)).toBe('4 Nov, 11:10')
  })
})

describe('the format values widgets accept', () => {
  it('the four forms, and the older names they replace', () => {
    expect(['age', 'ago', 'moment', 'date', 'relative', 'datetime', 'text', undefined].map(timeFormOf))
      .toEqual(['age', 'ago', 'moment', 'date', 'age', 'moment', undefined, undefined])
  })

  it('formatTime dispatches to each form', () => {
    const value = ago(52 * MIN)
    expect([formatTime(value, 'age', ROME), formatTime(value, 'ago', ROME), formatTime(value, 'moment', ROME), formatTime(value, 'date', ROME)])
      .toEqual(['52 minutes', '52 minutes ago', '25 Nov, 15:08', '25 Nov'])
  })
})
