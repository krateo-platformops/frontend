/**
 * LineChart's `slotField` (approved charts mockup, 2026-11-25; audit CHART-1). What the widget hands G2 for a chart
 * whose rows say which slots are still filling (`partial`) or have no data (`missing`), see utils/chartSlots:
 * - a slot with no data has no value, so the line BREAKS there (G2 breaks a line at a null), over a hatched band
 *   labelled "No data" that spans the gap, with "No data · 25 Nov, 09:50 to 10:20" on hover;
 * - the slot still filling ENDS the line with a dashed segment from the last whole slot and a hollow point,
 *   labelled "so far", and its hover value ends "so far".
 * Rows without a slot state are drawn exactly as without `slotField`.
 */
import { getColorCode } from '../../theme/palette'
import {
  type ChartRow,
  hatchPattern,
  missingRuns,
  noDataText,
  SO_FAR,
  slotLegendKeys,
  slotOf,
  slotsInOrder,
  slotStep,
  slotValue,
  xKey,
} from '../../utils/chartSlots'
import { toInstant } from '../../utils/dateFormat'

/** The field a band's far edge is carried in, beside `xField` (its near edge). Never a field a CR sends. */
const BAND_END = '\u0000slotBandEnd'
/** The field that keeps each dashed end its own path (G2 `series`), so two series' ends are never joined. */
const SEGMENT = '\u0000slotSegment'

export interface LineSlotOptions {
  colorField?: string
  slotField: string
  /** The tooltip title of a whole slot: its full date on a time axis, else the x value as G2 writes it. */
  titleOf: (x: unknown) => unknown
  xField: string
  xTimeUnit?: 'day' | 'hour'
  yField: string
}

/** A G2 mark, as an entry of the Line's `annotations` (drawn with the chart's own scales). */
type Mark = Record<string, unknown>

export const lineSlotLayers = (rows: readonly ChartRow[], options: LineSlotOptions) => {
  const { colorField, slotField, titleOf, xField, xTimeUnit, yField } = options
  const seriesOf = (row: ChartRow): string => (colorField ? String(row[colorField]) : '')
  const rowKey = (row: ChartRow): string => `${seriesOf(row)}\u0000${String(xKey(row[xField]))}`

  const slots = slotsInOrder(rows, xField)
  const order = new Map(slots.map((slot, index) => [xKey(slot), index]))
  const runs = missingRuns(rows, xField, slotField)
  const step = slotStep(slots)
  const toMoment = (slot: unknown) => toInstant(slot)
  const runTitle = new Map<unknown, string>()
  runs.forEach((run) => {
    const text = noDataText(run, { step, toMoment, unit: xTimeUnit })
    run.members.forEach((slot) => runTitle.set(xKey(slot), text))
  })

  // The line itself: no value where there is none, and none at the slot still filling, so the solid line stops at
  // the last whole slot. The value so far is kept for the hover and drawn by the dashed end.
  const valueSoFar = new Map<string, unknown>()
  const data = rows.map((row) => {
    const state = slotOf(row, slotField)
    if (!state) { return row }
    if (state === 'partial') { valueSoFar.set(rowKey(row), row[yField]) }
    return { ...row, [yField]: null }
  })

  // Each series' dashed end: from its last whole slot before the one still filling, when that slot has a value.
  const ends: ChartRow[] = []
  const partials: ChartRow[] = []
  const bySeries = new Map<string, ChartRow[]>()
  rows.forEach((row) => { bySeries.set(seriesOf(row), [...(bySeries.get(seriesOf(row)) ?? []), row]) })
  bySeries.forEach((seriesRows, series) => {
    const inOrder = [...seriesRows].sort((one, other) => (order.get(xKey(one[xField])) ?? 0) - (order.get(xKey(other[xField])) ?? 0))
    inOrder.forEach((row, index) => {
      if (slotOf(row, slotField) !== 'partial' || row[yField] === null || row[yField] === undefined) { return }
      partials.push(row)
      const before = inOrder[index - 1]
      if (before && !slotOf(before, slotField) && before[yField] !== null && before[yField] !== undefined) {
        const segment = `${series}\u0000${index}`
        ends.push({ ...before, [SEGMENT]: segment }, { ...row, [SEGMENT]: segment })
      }
    })
  })

  const colorEncode = colorField ? { color: colorField } : {}
  const ink = getColorCode('gray')
  const marks: Mark[] = []
  runs.forEach((run) => {
    marks.push({
      animate: false,
      data: [{ [BAND_END]: run.next ?? run.last, [xField]: run.previous ?? run.first }],
      encode: { x: xField, x1: BAND_END },
      labels: [{ dy: 14, fill: ink, fontSize: 11, position: 'top', text: () => 'No data' }],
      style: { fill: hatchPattern(), fillOpacity: 1, lineWidth: 1, stroke: getColorCode('border') },
      type: 'rangeX',
      zIndex: -1,
    })
  })
  if (ends.length) {
    marks.push({
      animate: false,
      data: ends,
      encode: { ...colorEncode, series: (row: ChartRow) => row[SEGMENT], x: xField, y: yField },
      style: { lineDash: [4, 3] },
      type: 'line',
    })
  }
  if (partials.length) {
    marks.push({
      animate: false,
      data: partials,
      encode: { ...colorEncode, shape: 'hollow', x: xField, y: yField },
      style: { fill: getColorCode('panelbg'), lineWidth: 2 },
      type: 'point',
    })
    marks.push({
      animate: false,
      data: [partials[0]],
      encode: { x: xField, y: yField },
      style: { dx: -6, dy: -9, fill: ink, fontSize: 11, text: SO_FAR, textAlign: 'end', textBaseline: 'bottom' },
      type: 'text',
    })
  }

  // On hover: a slot with no data is its run, "No data · …", with no series value under it (the tooltip filter
  // drops a null item); the slot still filling gives its value so far.
  const tooltip = {
    items: [(row: ChartRow) => {
      const state = slotOf(row, slotField)
      if (state === 'missing') { return null }
      const value = state === 'partial' ? valueSoFar.get(rowKey(row)) : row[yField]
      return { name: colorField ? seriesOf(row) : yField, value: slotValue(value, state) }
    }],
    title: (row: ChartRow) => runTitle.get(xKey(row[xField])) ?? titleOf(row[xField]),
  }

  return { data, legend: slotLegendKeys(rows, xField, slotField), marks, tooltip }
}
