import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Table as AntdTable, Progress, Result, Tag, Typography } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router'

import { useFilter } from '../../components/FiltesProvider/FiltersProvider'
import WidgetRenderer from '../../components/WidgetRenderer'
import { getColorCode, getTagStyle } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'
import { navigateOrExternal } from '../../utils/navigation'
import { formatISODate, formatRelativeTime, getEndpointUrl } from '../../utils/utils'

import styles from './Table.module.css'
import type { Table as WidgetType } from './Table.type'
import { computeTablePagination, shouldVirtualize, VIRTUAL_SCROLL_Y } from './tablePagination'
import { getColumnSortProps } from './tableSorting'

export type TableWidgetData = WidgetType['spec']['widgetData']

const Table = ({ resourcesRefs, serverPagination, uid, widgetData }: WidgetProps<TableWidgetData>) => {
  const { bordered, columns, dataSource, fitContent, pagination, prefix, rowNavigateTo, size } = widgetData
  const data = dataSource ?? []
  const { getFilteredData } = useFilter()
  const navigate = useNavigate()

  // Optional row → route navigation. `rowNavigateTo` is a path with `{valueKey}`
  // placeholders filled from that row's cells (e.g. "/compositions/{ns}/{name}").
  // When the WHOLE template is a single `{key}` placeholder, the cell holds a complete
  // pre-built route (the server precomputed a per-row branch — e.g. composition rows →
  // /compositions/.., others → /resources/..) so it's used VERBATIM, without encoding its
  // slashes. Multi-segment templates keep encoding each interpolated value as before.
  const wholeIsPlaceholder = /^\{[^}]+\}$/.test(rowNavigateTo ?? '')
  const buildRowPath = (row: NonNullable<TableWidgetData['dataSource']>[number]): string | undefined => {
    if (!rowNavigateTo) { return undefined }
    let missing = false
    const path = rowNavigateTo.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = row.find((cell) => cell.valueKey === key)?.stringValue
      if (value === undefined || value === '') {
        missing = true
        return ''
      }
      return wholeIsPlaceholder ? value : encodeURIComponent(value)
    })
    return missing ? undefined : path
  }

  // TODO: check if this works with RESTAction, it should not be displayed
  if (!columns.length) {
    return (
      <Result
        status='error'
        subTitle={'It is necessary to configure columns data in order to display Table data.'}
        title={'Error while rendering widget'}
      />
    )
  }

  let dataTable: TableWidgetData['dataSource'] = data
  if (prefix && data?.length > 0) {
    dataTable = getFilteredData(data, prefix) as TableWidgetData['dataSource']
  }

  const rowCount = dataTable?.length ?? 0

  // Virtualize once the row set is large enough to matter. `virtual` bounds the
  // mounted <tr> nodes to the scroll viewport (VIRTUAL_SCROLL_Y) regardless of
  // dataSource size — the load-bearing fix for the 60K-row `/compositions` wedge.
  // antd requires a fixed numeric `scroll.y` for virtual mode.
  const virtual = shouldVirtualize(rowCount)
  // `fitContent`: shrink columns to the container instead of the default horizontal scroll — a wide
  // cell then ellipsis-truncates (full text on hover) rather than pushing a scrollbar. Virtual tables
  // need a fixed scroll viewport, so fitContent only takes effect in the non-virtual (small) case.
  const horizontalScroll = fitContent ? undefined : { x: 'max-content' as const }
  const scroll = virtual ? { x: 'max-content' as const, y: VIRTUAL_SCROLL_Y } : horizontalScroll

  // Pagination: controlled server-side classic pager when the widget opts in
  // (serverPagination), else the CR's own pagination config (or none). See
  // computeTablePagination for the precedence + why virtual tables skip the
  // client pager.
  const paginationProp: TablePaginationConfig | false = computeTablePagination({ crPagination: pagination, rowCount, serverPagination })

  return (
    <AntdTable
      bordered={bordered}
      columns={columns?.map(({ color, title, valueKey }, index) => ({
        // UX #13: inferred client-side sorting — an automatic `sorter` comparing
        // the RAW dataSource values (numeric / kubectl-age / ISO-date / string,
        // sniffed per column) + `align: 'right'` for numeric/age columns. No
        // default sortOrder: the server's jq order stays until a header click.
        ...getColumnSortProps(dataTable, valueKey),
        dataIndex: valueKey,
        // With fitContent, truncate an overflowing cell (full text on hover) instead of widening the
        // table — this is what lets the table fit the container without a horizontal scrollbar.
        ellipsis: fitContent ? { showTitle: true } : undefined,
        key: `${uid}-col-${index}`,
        render: (_: unknown, row: NonNullable<TableWidgetData['dataSource']>[number]) => {
          const cell = row.find((cell) => cell.valueKey === valueKey)

          if (!cell) {
            console.error('Table rendering error: cell is undefined')
            return <span>-</span>
          }

          const { arrayValue, booleanValue, color: cellColor, decimalValue, format, kind, numberValue, resourceRefId, stringValue, type } = cell
          const endpoint = kind === 'widget' && resourceRefId && getEndpointUrl(resourceRefId, resourcesRefs)

          switch (kind) {
            case 'tag':
              // Per-row colored Tag (e.g. status Healthy/Failed/Pending). The color rides on
              // the cell so each row can differ. Resolved to the EXACT Petrol hex soft-tint
              // (not antd's preset palette) so the status pill is cyan/crimson/magenta/amber.
              return <Tag style={getTagStyle(cellColor ?? color)}>{stringValue ?? '-'}</Tag>

            case 'bar': {
              // Reconciliation-rail gauge cell (desired-vs-actual): cyan CONVERGED fill to
              // `stringValue`%, + a state-coloured diagonal HATCH remainder (--rail-rem) + an
              // amber target-tick at 100% (`.railBar`). Mirrors the List `rail` variant.
              const pct = Number(stringValue)
              const barColor = getColorCode(cellColor ?? color)
              return (
                <div className={styles.railBar} style={{ '--rail-rem': barColor } as CSSProperties}>
                  <Progress percent={Number.isFinite(pct) ? pct : 0} showInfo={false} size='small' strokeColor={getColorCode('cyan')} />
                </div>
              )
            }

            case 'conditions': {
              // The row's REAL status.conditions as small pills, each coloured by its own status —
              // replaces a single derived "Healthy/Drift" Tag, so every condition shows honestly.
              // Passed as a JSON string ([{type,status,color}]) in `stringValue` (avoids widening
              // the `arrayValue: string[]` cell type). The per-condition `color` is computed
              // SERVER-SIDE in the RESTAction jq (True=cyan / False=crimson) — same nothing-hardcoded
              // pattern as the sibling `bar` cell's railState colour; the widget never maps
              // status→colour itself. A CR predating the field degrades gracefully to neutral gray.
              let conds: { color?: string; status?: string; type?: string }[] = []
              try {
                conds = stringValue ? (JSON.parse(stringValue) as { color?: string; status?: string; type?: string }[]) : []
              } catch {
                conds = []
              }
              if (!Array.isArray(conds) || !conds.length) { return <span>-</span> }
              return (
                <div className={styles.conditions}>
                  {conds.map((cond) => <Tag key={cond.type} style={getTagStyle(cond.color ?? 'gray')}>{cond.type}</Tag>)}
                </div>
              )
            }

            case 'icon':
              if (stringValue) { return <FontAwesomeIcon color={color} icon={stringValue as IconProp} /> }
              console.error('Table rendering error: icon value has incorrect format')
              return <span>-</span>

            case 'widget':
              if (!resourceRefId) {
                console.error('Table rendering error: widget resourceRefId not found')
                return <span>-</span>
              }

              if (!endpoint) {
                console.error('Table rendering error: widget resourceRefId endpoint not found')
                return <span>-</span>
              }

              return <WidgetRenderer widgetEndpoint={endpoint} />

            case 'jsonSchemaType':
              if (!type) {
                console.error('Table rendering error: jsonSchemaType cell missing type')
                return <span>-</span>
              }

              switch (type) {
                case 'string': {
                  // Optional display format (relative age / formatted date) — the raw
                  // value stays in the data; only the rendering changes.
                  const formatted = (() => {
                    if (!stringValue) { return '-' }
                    if (format === 'relative') { return formatRelativeTime(stringValue) }
                    if (format === 'date' || format === 'datetime') { return formatISODate(stringValue, format === 'datetime') }
                    return stringValue
                  })()
                  return <span style={{ color: cellColor ?? color }}>{formatted}</span>
                }
                case 'number':
                case 'integer':
                  return <span style={{ color }}>{numberValue ?? '-'}</span>
                case 'decimal':
                  return <span style={{ color }}>{String(decimalValue) ?? '-'}</span>
                case 'boolean':
                  return <span style={{ color }}>{booleanValue !== undefined ? String(booleanValue) : '-'}</span>
                case 'array':
                  return <span style={{ color }}>{arrayValue ? arrayValue.join(', ') : '-'}</span>
                case 'null':
                  return <span>-</span>
                default:
                  console.error('Table rendering error: unknown jsonSchemaType')
                  return <span>-</span>
              }

            default:
              console.error('Table rendering error: unknown kind')
              return <span>-</span>
          }
        },
        title: (
          <div className={styles.headerEllipsis}>
            <Typography.Text ellipsis={{ tooltip: true }}>
              {title}
            </Typography.Text>
          </div>
        ),
      }))}
      dataSource={dataTable}
      key={uid}
      onRow={rowNavigateTo
        ? (row) => {
          const path = buildRowPath(row)
          if (!path) { return {} }
          const go = () => navigateOrExternal(navigate, path)
          // a11y: a clickable row must be keyboard-operable — focusable (tabIndex),
          // announced as an actionable control (role=button), and activated by Enter/Space
          // (matching native button semantics). Previously mouse-click only.
          return {
            onClick: go,
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                go()
              }
            },
            role: 'button',
            style: { cursor: 'pointer' },
            tabIndex: 0,
          }
        }
        : undefined}
      pagination={paginationProp}
      scroll={scroll}
      size={size ?? 'middle'}
      virtual={virtual}
    />
  )
}

export default Table
