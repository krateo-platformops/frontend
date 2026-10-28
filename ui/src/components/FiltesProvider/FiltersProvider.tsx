import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { createContext, useState, useContext, useEffect } from 'react'

import { useEvents } from '../../hooks/useEvents'
import type { TableWidgetData } from '../../widgets/Table/Table'

export type FilterType = {
  // Optional: when omitted (e.g. filters built from composed control widgets), the
  // match strategy is inferred from the value type. Table-style filters still pass it.
  fieldType?: 'string' | 'number' | 'boolean' | 'date' | 'daterange'
  fieldName: string[]
  fieldValue: unknown
}

const inferFieldType = (value: unknown): NonNullable<FilterType['fieldType']> => {
  if (dayjs.isDayjs(value)) { return 'date' }
  if (Array.isArray(value) && dayjs.isDayjs(value[0])) { return 'daterange' }
  if (typeof value === 'boolean') { return 'boolean' }
  if (typeof value === 'number') { return 'number' }
  return 'string'
}

type FilterMap = Record<string, FilterType[]>
type TableRow = NonNullable<TableWidgetData['dataSource']>[number]
type FilterableRow = Record<string, unknown> | TableRow

type FiltersContextType = {
  setFilters: (prefix: string, filters: FilterType[]) => void
  getFilteredData: (data: FilterableRow[], prefix: string) => FilterableRow[]
  isWidgetFilteredByProps: (widgetData: unknown, prefix: string) => boolean
  clearFilters: (prefix: string) => void
  getFilters: (prefix: string) => FilterType[]
}

type FilterEvent = {
  setFilters: { prefix: string; filters: FilterType[] }
  clearFilters: { prefix: string }
  setData: { componentId: string; prefix: string; data: unknown[] }
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined)

const getTableValue = (cell: TableRow[number]): unknown => {
  const { arrayValue, booleanValue, kind, numberValue, resourceRefId, stringValue, type } = cell

  switch (kind) {
    case 'icon':
      return stringValue ?? null

    case 'widget':
      return resourceRefId ?? stringValue ?? null

    case 'jsonSchemaType':
      if (!type) { return null }
      switch (type) {
        case 'string':
          return stringValue ?? null
        case 'number':
        case 'integer':
          return numberValue ?? null
        case 'boolean':
          return booleanValue ?? null
        case 'array':
          return arrayValue ?? null
        case 'null':
          return null
        default:
          return null
      }

    default:
      return null
  }
}

const FiltersProvider = ({ children }: { children: ReactNode }) => {
  const [filterMap, setFilterMap] = useState<FilterMap>({})
  const { off, on } = useEvents<FilterEvent>()

  const setFilters = (prefix: string, filters: FilterType[]) => {
    setFilterMap((prev) => ({
      ...prev,
      [prefix]: filters.filter(({ fieldValue }) => fieldValue !== undefined),
    }))
  }

  const getFilters = (prefix: string) => filterMap[prefix]

  const clearFilters = (prefix: string) => {
    setFilterMap((prev) => {
      const { [prefix]: _, ...rest } = prev
      return rest
    })
  }

  useEffect(() => {
    on('setFilters', ({ filters, prefix }) => setFilters(prefix, filters))
    on('clearFilters', ({ prefix }) => clearFilters(prefix))

    return () => {
      off('setFilters', ({ filters, prefix }) => setFilters(prefix, filters))
      off('clearFilters', ({ prefix }) => clearFilters(prefix))
    }
  }, [off, on])

  const matchesFilter = (itemValue: unknown, filter: FilterType): boolean => {
    const { fieldValue } = filter
    const fieldType = filter.fieldType ?? inferFieldType(fieldValue)

    if (itemValue === null || itemValue === undefined) {
      return false
    }

    switch (fieldType) {
      case 'string':
        if (Array.isArray(itemValue)) {
          return itemValue.filter((val: string) => val.toLowerCase().includes((fieldValue as string).toLowerCase())).length > 0
        }

        return (itemValue as string).toLowerCase().includes((fieldValue as string).toLowerCase())

      case 'number': {
        return Number(itemValue) === Number(fieldValue)
      }

      case 'boolean': {
        const normalizedFilterValue = typeof fieldValue === 'boolean'
          ? fieldValue
          : fieldValue === 'true'

        return Boolean(itemValue) === normalizedFilterValue
      }

      case 'date':
        if (typeof itemValue === 'string' && dayjs.isDayjs(fieldValue)) {
          return dayjs(itemValue).startOf('day').isSame(fieldValue.startOf('day'), 'day')
        }
        return true

      case 'daterange': {
        if (typeof itemValue === 'string' && Array.isArray(fieldValue) && dayjs.isDayjs(fieldValue[0]) && dayjs.isDayjs(fieldValue[1])) {
          const date = dayjs(itemValue).startOf('day')

          const fromValid = fieldValue[0] ? date.isSame(fieldValue[0].startOf('day')) || date.isAfter(fieldValue[0].startOf('day')) : true
          const toValid = fieldValue[1] ? date.isSame(fieldValue[1].startOf('day')) || date.isBefore(fieldValue[1].startOf('day')) : true

          return fromValid && toValid
        }
        return true
      }

      default:
        return itemValue === fieldValue
    }
  }

  const getValueByPath = (obj: FilterableRow, path: string): unknown => {
    return path.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], obj)
  }

  const getFilteredData = (data: FilterableRow[], prefix: string): FilterableRow[] => {
    const filters: FilterType[] = (filterMap[prefix]) ?? []

    if (filters.length === 0) { return data }

    return data.filter(row =>
      filters.every(filter =>
        filter.fieldName.some(fieldName => {
          let value: unknown

          if (Array.isArray(row)) {
            const cell = row.find(({ valueKey }) => valueKey === fieldName)
            if (!cell) { return false }
            value = getTableValue(cell)
          } else {
            value = getValueByPath(row, fieldName)
          }

          return matchesFilter(value, filter)
        })
      )
    )
  }

  const isWidgetFilteredByProps = (widgetData: unknown, prefix: string): boolean => {
    if (typeof widgetData !== 'object' || widgetData === null || ('prefix' in widgetData)) {
      return false
    }
    const dataObj = widgetData as Record<string, unknown>
    const filters: FilterType[] = (filterMap[prefix]) ?? []

    if (filters.length === 0) { return false }

    for (const filter of filters) {
      const allFieldsFail = filter.fieldName.every(fieldPath => {
        const value = getValueByPath(dataObj, fieldPath)
        return value === undefined || !matchesFilter(value, filter)
      })

      if (allFieldsFail) {
        // None of the specified properties match the filter → The widget is filtered out by this filter
        return true
      }
    }

    return false
  }

  return (
    <FiltersContext.Provider value={{
      clearFilters,
      getFilteredData,
      getFilters,
      isWidgetFilteredByProps,
      setFilters,
    }}>
      {children}
    </FiltersContext.Provider>
  )
}

export default FiltersProvider

export const useFilter = () => {
  const context = useContext(FiltersContext)
  if (!context) {
    throw new Error('user useFilter into FiltersProvider')
  }
  return context
}
