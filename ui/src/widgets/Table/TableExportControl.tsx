/**
 * The Table's export control: one button, three formats (snowplow#980, 1.12.62).
 *
 * WHAT IT HAS TO SAY, AND WHY IT IS NOT JUST A DOWNLOAD BUTTON. The three formats behave
 * differently at snowplow's 50,000-row bound, and two of those outcomes are easy to miss:
 *
 *   - csv and json come back TRUNCATED, with `X-Export-Truncated: true`. The file is valid and
 *     holds the first 50,000 rows, so the download succeeds and the person must still be told it
 *     is partial — a silently incomplete export is the failure this feature exists to avoid.
 *   - pdf is never truncated: at the bound it answers 422 with no file at all, so there is nothing
 *     to download and the error is the whole outcome.
 *
 * A plain spinner-then-nothing would read as success in both cases.
 */
import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Dropdown, notification } from 'antd'
import { useState } from 'react'

import type { Table as WidgetType } from './Table.type'
import { buildExportRequest, type ExportFormat, exportFilename } from './tableExport'
import { runExport } from './tableExportRun'

type Columns = NonNullable<WidgetType['spec']['widgetData']['columns']>

/** Offered in the order people reach for them: the spreadsheet first. */
const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'csv', label: 'CSV' },
  { format: 'json', label: 'JSON' },
  { format: 'pdf', label: 'PDF' },
]

interface TableExportControlProps {
  columns: Columns | undefined
  /** From WidgetProps — the hook that owns this widget's URL assembly. */
  exportUrlFor: (exportQuery: string) => string
  onSessionExpired?: () => void
}

const TableExportControl = ({ columns, exportUrlFor, onSessionExpired }: TableExportControlProps) => {
  const [running, setRunning] = useState<ExportFormat | null>(null)

  const start = async (format: ExportFormat) => {
    const request = buildExportRequest(columns, format)
    if (!request) {
      // The trigger is not rendered in this case, so reaching here means the columns changed
      // under an open menu. Say something rather than appear to do nothing.
      notification.warning({ message: 'This table has no columns to export', placement: 'bottomLeft' })
      return
    }
    setRunning(format)
    try {
      const outcome = await runExport(exportUrlFor(request.params), format, exportFilename(format), { onSessionExpired })
      if (outcome.ok && outcome.truncated) {
        notification.warning({
          description: 'The file holds the first 50,000 rows. Narrow the table with a filter to export the rest.',
          message: `${format.toUpperCase()} export is incomplete`,
          placement: 'bottomLeft',
        })
      } else if (!outcome.ok && !('sessionExpired' in outcome)) {
        // The session-expired path already raised the resume modal; a second message there would
        // compete with it for the same corner.
        notification.error({
          description: outcome.message,
          message: `${format.toUpperCase()} export failed`,
          placement: 'bottomLeft',
        })
      }
    } finally {
      setRunning(null)
    }
  }

  return (
    <Dropdown
      disabled={running !== null}
      menu={{
        items: FORMATS.map(({ format, label }) => ({
          key: format,
          label,
          onClick: () => { void start(format) },
        })),
      }}
      trigger={['click']}
    >
      <Button
        aria-label='Export'
        icon={<FontAwesomeIcon icon={['fas', 'download'] as IconProp} />}
        loading={running !== null}
        size='small'
        type='text'
      />
    </Dropdown>
  )
}

export default TableExportControl
