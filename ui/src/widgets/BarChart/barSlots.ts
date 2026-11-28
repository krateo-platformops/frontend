/**
 * BarChart's slot marks (approved charts mockup, 2026-11-25; audit CHART-1 and CHART-3), see utils/chartSlots:
 * - a measured 0 is a 2px hairline on the baseline in the neutral grey: a bar of height 0 drew nothing, so a
 *   zero could not be told from no data, and it is never painted in a series colour (a red "Opened" series
 *   never paints a zero). The only place the widget treats 0 specially; it only makes the measurement visible.
 * - with `slotField`, the bar still filling (`partial`) is a faint fill inside a dashed outline, in its series
 *   colour, labelled "so far"; a slot with no data (`missing`) draws no bar but a hatched band labelled "No data".
 */
import { getColorCode } from '../../theme/palette'
import {
  type ChartRow,
  hatchPattern,
  missingRuns,
  momentOfSeconds,
  noDataText,
  SO_FAR,
  slotLegendKeys,
  slotOf,
  slotsInOrder,
  slotStep,
  slotValue,
  xKey,
} from '../../utils/chartSlots'

/** The field a band's far edge is carried in, beside `xField`. Never a field a CR sends. */
const BAND_END = '\u0000slotBandEnd'
/** The field the "so far" label's height is carried in: the top of the slot's bars. */
const LABEL_Y = '\u0000slotLabelY'

export interface BarSlotOptions {
  colorField?: string
  slotField?: string
  stack?: boolean
  /** The tooltip title of a whole slot: its full date on a time axis, else the x value. */
  titleOf: (x: unknown) => unknown
  xField: string
  xTimeUnit?: 'day' | 'hour'
  yField: string
}

const isZero = (value: unknown): boolean => value === 0 || value === '0'

export const barSlotLayers = (rows: readonly ChartRow[], options: BarSlotOptions) => {
  const { colorField, slotField, stack, titleOf, xField, xTimeUnit, yField } = options
  const inSlot = new Map<unknown, ChartRow[]>()
  rows.forEach((row) => { inSlot.set(xKey(row[xField]), [...(inSlot.get(xKey(row[xField])) ?? []), row]) })

  // A zero is drawn where it is the bar: every bar of a plain or grouped chart, the whole stack of a stacked one
  // (a zero inside a stack that has height is no bar of its own, and a hairline there would sit on another bar).
  const hairline = (row: ChartRow): boolean => {
    if (slotOf(row, slotField) === 'missing' || !isZero(row[yField])) { return false }
    return !stack || (inSlot.get(xKey(row[xField])) ?? []).every((other) => isZero(other[yField]) || slotOf(other, slotField) === 'missing')
  }
  const faint = getColorCode('faint')
  const style = {
    fill: (row: ChartRow) => (hairline(row) ? faint : undefined),
    fillOpacity: (row: ChartRow) => {
      const state = slotOf(row, slotField)
      if (state === 'missing') { return 0 }
      return state === 'partial' ? 0.18 : undefined
    },
    lineDash: (row: ChartRow) => (slotOf(row, slotField) === 'partial' ? [3, 2] : undefined),
    lineWidth: (row: ChartRow) => (slotOf(row, slotField) === 'partial' ? 1.3 : undefined),
    minHeight: (row: ChartRow) => (hairline(row) ? 2 : undefined),
    stroke: (row: ChartRow) => (hairline(row) && slotOf(row, slotField) === 'partial' ? faint : undefined),
  }

  if (!slotField) { return { data: rows, legend: { missing: false, partial: false }, marks: [], style, tooltip: undefined } }

  // A slot with no data keeps its rows, at 0 and drawn with no fill, so its column still answers a hover (G2 finds
  // a bar's tooltip by its slot) with "No data · …".
  const data = rows.map((row) => (slotOf(row, slotField) === 'missing' ? { ...row, [yField]: 0 } : row))

  const slots = slotsInOrder(rows, xField)
  const runs = missingRuns(rows, xField, slotField)
  const runTitle = new Map<unknown, string>()
  const toMoment = xTimeUnit ? momentOfSeconds : undefined
  runs.forEach((run) => {
    const text = noDataText(run, { step: slotStep(slots), toMoment, unit: xTimeUnit })
    run.members.forEach((slot) => runTitle.set(xKey(slot), text))
  })

  const ink = getColorCode('gray')
  const marks: Record<string, unknown>[] = runs.map((run) => ({
    animate: false,
    data: [{ [BAND_END]: run.last, [xField]: run.first }],
    encode: { x: xField, x1: BAND_END },
    labels: [{ dy: 14, fill: ink, fontSize: 11, position: 'top', text: () => 'No data' }],
    style: { fill: hatchPattern(), fillOpacity: 1, lineWidth: 1, stroke: getColorCode('border') },
    type: 'rangeX',
    zIndex: -1,
  }))
  // "so far" over the slot still filling, at the top of its bars (the stack's total when stacked).
  const partialSlots = slots.filter((slot) => (inSlot.get(xKey(slot)) ?? []).some((row) => slotOf(row, slotField) === 'partial'))
  if (partialSlots.length) {
    const top = (slot: unknown) => {
      const values = (inSlot.get(xKey(slot)) ?? []).map((row) => Number(row[yField]) || 0)
      return stack ? values.reduce((sum, value) => sum + value, 0) : Math.max(0, ...values)
    }
    marks.push({
      animate: false,
      data: partialSlots.map((slot) => ({ [LABEL_Y]: top(slot), [xField]: slot })),
      encode: { x: xField, y: LABEL_Y },
      style: { dy: -6, fill: ink, fontSize: 11, text: SO_FAR, textAlign: 'center', textBaseline: 'bottom' },
      type: 'text',
    })
  }

  const tooltip = {
    items: [(row: ChartRow) => {
      const state = slotOf(row, slotField)
      if (state === 'missing') { return null }
      return { name: colorField ? String(row[colorField]) : yField, value: slotValue(row[yField], state) }
    }],
    title: (row: ChartRow) => runTitle.get(xKey(row[xField])) ?? titleOf(row[xField]),
  }

  return { data, legend: slotLegendKeys(rows, xField, slotField), marks, style, tooltip }
}
