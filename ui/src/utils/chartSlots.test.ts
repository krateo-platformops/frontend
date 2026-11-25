/**
 * Slot states shared by LineChart and BarChart (approved charts mockup, 2026-11-25; audit CHART-1, CHART-3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasTooltipValue, missingRuns, momentOfSeconds, noDataText, slotLegendKeys, slotOf, slotsInOrder, slotStep, slotValue } from './chartSlots'

const at = (hour: number, minute = 0) => new Date(2026, 10, 25, hour, minute)

beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 25, 20), toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('slot states', () => {
  it('only partial and missing are states; anything else, or no slotField, is a whole slot', () => {
    expect([slotOf({ s: 'partial' }, 's'), slotOf({ s: 'missing' }, 's'), slotOf({ s: 'whole' }, 's'), slotOf({}, 's'), slotOf({ s: 'partial' }, undefined)])
      .toEqual(['partial', 'missing', undefined, undefined, undefined])
  })

  it('slots run in time order whatever the row order; labels keep the order sent', () => {
    expect(slotsInOrder([{ x: 30 }, { x: 10 }, { x: 20 }, { x: 10 }], 'x')).toEqual([10, 20, 30])
    expect(slotsInOrder([{ x: at(2) }, { x: at(1) }], 'x')).toEqual([at(1), at(2)])
    expect(slotsInOrder([{ x: 'b' }, { x: 'a' }], 'x')).toEqual(['b', 'a'])
  })

  it('the step is the smallest gap between slots', () => {
    expect(slotStep([0, 600, 1200, 3000])).toBe(600)
    expect(slotStep(['a', 'b'])).toBeUndefined()
  })
})

describe('runs of slots with no data', () => {
  const rows = [
    { s: undefined, x: 0 }, { s: 'missing', x: 600 }, { s: 'missing', x: 1200 }, { s: undefined, x: 1800 }, { s: 'missing', x: 2400 },
  ]

  it('each run names its slots and the slots either side, where the line stops and starts again', () => {
    expect(missingRuns(rows, 'x', 's')).toEqual([
      { first: 600, last: 1200, members: [600, 1200], next: 1800, previous: 0 },
      { first: 2400, last: 2400, members: [2400], next: undefined, previous: 1800 },
    ])
  })

  it('with several series a slot has no data only when every series has none', () => {
    const series = [{ k: 'a', s: 'missing', x: 1 }, { k: 'b', x: 1 }, { k: 'a', s: 'missing', x: 2 }, { k: 'b', s: 'missing', x: 2 }]
    expect(missingRuns(series, 'x', 's').map(({ members }) => members)).toEqual([[2]])
  })

  it('without slotField there are none', () => {
    expect(missingRuns(rows, 'x', undefined)).toEqual([])
  })
})

describe('what a run says on hover', () => {
  it('hourly: from the first empty slot to where the last one ends, in the viewer’s zone', () => {
    const run = { first: at(9, 50), last: at(10, 10), members: [], next: undefined, previous: undefined }
    expect(noDataText(run, { step: 600_000, toMoment: (slot) => (slot instanceof Date ? slot : new Date(slot as number)), unit: 'hour' }))
      .toBe('No data · 25 Nov, 09:50 to 10:20')
  })

  it('a run that ends on another day names that day', () => {
    const run = { first: at(23), last: at(23), members: [] }
    expect(noDataText(run, { step: 3_600_000, toMoment: (slot) => (slot instanceof Date ? slot : new Date(slot as number)), unit: 'hour' }))
      .toBe('No data · 25 Nov, 23:00 to 26 Nov, 00:00')
  })

  it('daily: the days, one when the run is one day; epoch seconds read as moments', () => {
    const day = (date: number) => new Date(2026, 10, date).getTime() / 1000
    expect(noDataText({ first: day(23), last: day(24), members: [] }, { toMoment: momentOfSeconds, unit: 'day' })).toBe('No data · 23 Nov to 24 Nov')
    expect(noDataText({ first: day(24), last: day(24), members: [] }, { toMoment: momentOfSeconds, unit: 'day' })).toBe('No data · 24 Nov')
  })

  it('not a time axis: the slots as labelled', () => {
    expect(noDataText({ first: 'Mon', last: 'Tue', members: [] }, {})).toBe('No data · Mon to Tue')
  })
})

describe('tooltip and legend', () => {
  it('a slot still filling ends “so far”; a whole slot is its value', () => {
    expect([slotValue(412, 'partial'), slotValue(412, undefined)]).toEqual(['412 · so far', 412])
  })

  it('an item with no value is dropped, a zero is kept', () => {
    expect([hasTooltipValue({ value: null }), hasTooltipValue({}), hasTooltipValue({ value: 0 })]).toEqual([false, false, true])
  })

  it('the legend names only the marks drawn', () => {
    expect(slotLegendKeys([{ s: 'partial', x: 1 }], 'x', 's')).toEqual({ missing: false, partial: true })
    expect(slotLegendKeys([{ s: 'missing', x: 1 }, { x: 2 }], 'x', 's')).toEqual({ missing: true, partial: false })
    expect(slotLegendKeys([{ x: 1 }], 'x', 's')).toEqual({ missing: false, partial: false })
  })
})
