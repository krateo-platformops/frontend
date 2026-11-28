/**
 * Time slots that are not a whole measurement (approved charts mockup, 2026-11-25; visual audit CHART-1 and
 * CHART-3). A chart's row may say, in the field its `slotField` names, that its slot is:
 * - `partial`: the slot that holds now, still filling. Its value is what was measured so far, and drawing it as
 *   a whole slot made every chart dip at its newest point.
 * - `missing`: nothing was recorded in the slot at all, so there is no value (null). It is not a zero: a line
 *   joined straight across it and a bar chart drew nothing, which read as one.
 * Any other value, or none, is a whole, measured slot. LineChart and BarChart both read this module, so the
 * two charts state the same thing the same way.
 */
import { getColorCode } from '../theme/palette'

import { formatClock, formatDate, formatMoment, toInstant } from './dateFormat'

export type SlotState = 'missing' | 'partial'

export type ChartRow = Record<string, unknown>

/** The slot state a row declares, or undefined for a whole slot (and for every row of a chart without `slotField`). */
export const slotOf = (row: ChartRow, slotField: string | undefined): SlotState | undefined => {
  if (!slotField) { return undefined }
  const state = row[slotField]
  return state === 'missing' || state === 'partial' ? state : undefined
}

/** A value on the x axis as something that compares: a moment by its epoch, anything else as it is. */
export const xKey = (value: unknown): unknown => (value instanceof Date ? value.getTime() : value)

/** The slots of a chart in axis order: by time when every slot is a number or a moment, else in the order sent. */
export const slotsInOrder = (rows: readonly ChartRow[], xField: string): unknown[] => {
  const seen = new Map<unknown, unknown>()
  rows.forEach((row) => {
    const key = xKey(row[xField])
    if (!seen.has(key)) { seen.set(key, row[xField]) }
  })
  const keys = [...seen.keys()]
  if (keys.length > 1 && keys.every((key) => typeof key === 'number' && Number.isFinite(key))) {
    (keys as number[]).sort((one, other) => one - other)
  }
  return keys.map((key) => seen.get(key))
}

/** A run of consecutive slots with no data, and the slots either side of it, where a line stops and starts again. */
export interface MissingRun {
  /** The first slot with no data. */
  first: unknown
  /** The last slot with no data. */
  last: unknown
  /** Every slot of the run, `first` to `last`. */
  members: unknown[]
  /** The slot after `last`, where the data starts again; undefined when the run reaches the end of the chart. */
  next?: unknown
  /** The slot before `first`, where the data stops; undefined when the run starts the chart. */
  previous?: unknown
}

/**
 * The runs of slots with no data. A slot has no data when EVERY row in it is `missing`: with several series, one
 * series without a value breaks only its own line, while a band over the slot would say the others had none too.
 */
export const missingRuns = (rows: readonly ChartRow[], xField: string, slotField: string | undefined): MissingRun[] => {
  if (!slotField) { return [] }
  const slots = slotsInOrder(rows, xField)
  const missing = new Set(slots.map(xKey).filter((key) => {
    const inSlot = rows.filter((row) => xKey(row[xField]) === key)
    return inSlot.length > 0 && inSlot.every((row) => slotOf(row, slotField) === 'missing')
  }))
  const runs: MissingRun[] = []
  let index = 0
  while (index < slots.length) {
    if (!missing.has(xKey(slots[index]))) {
      index += 1
      continue
    }
    let end = index
    while (end + 1 < slots.length && missing.has(xKey(slots[end + 1]))) { end += 1 }
    runs.push({ first: slots[index], last: slots[end], members: slots.slice(index, end + 1), next: slots[end + 1], previous: index > 0 ? slots[index - 1] : undefined })
    index = end + 1
  }
  return runs
}

/** How far apart two slots are on a time axis: the smallest step between consecutive slots, in the axis' own unit. */
export const slotStep = (slots: readonly unknown[]): number | undefined => {
  const keys = slots.map(xKey).filter((key): key is number => typeof key === 'number' && Number.isFinite(key))
  let step: number | undefined
  for (let index = 1; index < keys.length; index += 1) {
    const gap = keys[index] - keys[index - 1]
    if (gap > 0 && (step === undefined || gap < step)) { step = gap }
  }
  return step
}

/** The axis unit a chart's time slots are in: `hour` slots are read to the minute, `day` slots to the day. */
export type SlotUnit = 'day' | 'hour'

/**
 * What a run of slots with no data says on hover: "No data · 25 Nov, 09:50 to 10:20", the end being where the
 * last empty slot ends; on a daily axis the days themselves, "No data · 23 Nov to 24 Nov" ("No data · 24 Nov" for
 * one). `toMoment` reads a slot as its moment (a chart's x is a Date or epoch seconds); a chart that is not on a
 * time axis names its slots as they are labelled.
 */
export const noDataText = (
  run: MissingRun,
  options: { step?: number; toMoment?: (slot: unknown) => Date | undefined; unit?: SlotUnit },
): string => {
  const { step, toMoment, unit } = options
  const first = toMoment?.(run.first)
  const last = toMoment?.(run.last)
  if (!unit || !first || !last) {
    return run.first === run.last ? `No data · ${String(run.first)}` : `No data · ${String(run.first)} to ${String(run.last)}`
  }
  if (unit === 'day') {
    return formatDate(first) === formatDate(last) ? `No data · ${formatDate(first)}` : `No data · ${formatDate(first)} to ${formatDate(last)}`
  }
  const lastKey = xKey(run.last)
  const end = step !== undefined && typeof lastKey === 'number' ? toMoment?.(lastKey + step) ?? last : last
  const sameDay = formatDate(first) === formatDate(end)
  return `No data · ${formatMoment(first)} to ${sameDay ? formatClock(end) : formatMoment(end)}`
}

/** A moment from epoch SECONDS (a BarChart's x, kept a number so a band keys one bucket's series together). */
export const momentOfSeconds = (slot: unknown): Date | undefined => (typeof slot === 'number' ? toInstant(slot * 1000) : undefined)

/** What the tooltip says after the value of a slot still filling. */
export const SO_FAR = 'so far'

/** The tooltip value of a row: its measurement, and "so far" after it when its slot is still filling. */
export const slotValue = (value: unknown, state: SlotState | undefined): unknown => (
  state === 'partial' ? `${String(value)} · ${SO_FAR}` : value
)

/**
 * The hatch a slot with no data is drawn with: thin diagonal lines in the neutral `faint` ink, half opacity, every
 * 6px, as the mockup's band. G draws a pattern from an image; an SVG data URL needs no canvas of our own (and
 * none under jsdom). Read per render, so it follows the light/dark toggle.
 */
export const hatchPattern = (): { image: string; repetition: 'repeat' } => {
  const ink = getColorCode('faint')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><path d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2" stroke="${ink}" stroke-opacity="0.5" stroke-width="1.3"/></svg>`
  return { image: `data:image/svg+xml,${encodeURIComponent(svg)}`, repetition: 'repeat' }
}

/** Which slot marks a chart shows, so its legend names exactly those: "so far" and "no data" only when drawn. */
export interface SlotLegendKeys {
  missing: boolean
  partial: boolean
}

export const slotLegendKeys = (rows: readonly ChartRow[], xField: string, slotField: string | undefined): SlotLegendKeys => ({
  missing: missingRuns(rows, xField, slotField).length > 0,
  partial: rows.some((row) => slotOf(row, slotField) === 'partial'),
})

/**
 * Drops an item G2 was handed with no value: a slot with no data has a title on hover ("No data · …") and no
 * series value under it (G2 writes a null as "null"). Passed as the tooltip interaction's `filter`.
 */
export const hasTooltipValue = (item: { value?: unknown }): boolean => item.value !== null && item.value !== undefined
