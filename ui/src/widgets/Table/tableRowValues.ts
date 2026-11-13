import type { Table as WidgetType } from './Table.type'

type Row = NonNullable<WidgetType['spec']['widgetData']['dataSource']>[number]
type Cell = Row[number]

/**
 * A cell's value as its data carries it: the typed field a `jsonSchemaType` cell declares
 * (numberValue for a number or integer, decimalValue, booleanValue, arrayValue), else its
 * stringValue — which is also what every other kind (tag, bar, icon, conditions) carries. A cell
 * with none (a `widget` cell, an empty one) has no value.
 */
const cellValue = (cell: Cell): unknown => {
  const byType: Record<string, unknown> = {
    array: cell.arrayValue,
    boolean: cell.booleanValue,
    decimal: cell.decimalValue,
    integer: cell.numberValue,
    number: cell.numberValue,
  }
  const typed = cell.kind === 'jsonSchemaType' && cell.type ? byType[cell.type] : undefined
  return typed ?? cell.stringValue
}

/**
 * A Table row as the payload a `rowActions` entry fires with (#700): `{ [valueKey]: value }` for
 * each cell that has a value. List hands its actions the row's data object; a Table row is an
 * array of cells, and this is the same row keyed the way its own `rowNavigateTo` addresses it — so
 * an action path of `/compositions/${ns}/${name}` reads the row's `ns` and `name` cells.
 */
export const tableRowValues = (row: Row): Record<string, unknown> => {
  const values: Record<string, unknown> = {}
  for (const cell of row) {
    const value = cellValue(cell)
    if (value !== undefined) { values[cell.valueKey] = value }
  }
  return values
}
