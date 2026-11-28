import { RightOutlined } from '@ant-design/icons'
import { Alert as AntdAlert, Button, Tag } from 'antd'
import { type ReactNode, useId, useState } from 'react'

import { getTagStyle } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './Alert.module.css'
import type { Alert as WidgetType } from './Alert.type'

export type AlertWidgetData = WidgetType['spec']['widgetData']

type RowsFold = NonNullable<AlertWidgetData['rowsFold']>
type AlertType = NonNullable<AlertWidgetData['type']>

/**
 * The type antd paints when the CR names none: a banner is a warning, anything else is info. The
 * tag takes the same colour as the box it sits in, so it has to know which one antd chose.
 */
const paintedType = ({ banner, type }: AlertWidgetData): AlertType => type ?? (banner ? 'warning' : 'info')

/**
 * A disclosure inside the alert's body: a real button, so it is reached by Tab and toggled by Enter
 * or Space, and `aria-expanded` announces which way it is; the chevron is aria-hidden so the
 * button's name is just its label. The panel stays in the DOM, hidden, so `aria-controls` always
 * points at something.
 */
const Disclosure = ({ children, className, label, open: initiallyOpen = false }: {
  children: ReactNode
  className?: string
  label: string
  open?: boolean
}) => {
  const id = useId()
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className={styles.details}>
      <Button
        aria-controls={id}
        aria-expanded={open}
        className={styles.toggle}
        icon={<RightOutlined aria-hidden className={open ? styles.chevronOpen : styles.chevron} />}
        onClick={() => { setOpen((prev) => !prev) }}
        size='small'
        type='link'
      >
        {label}
      </Button>
      <div className={className} hidden={!open} id={id}>{children}</div>
    </div>
  )
}

/**
 * The message behind the alert, folded away under "Details": the title (and its tag) says what
 * happened, the details say exactly what the server answered. Plain text, line breaks kept, in the
 * alert's own body text once open.
 */
const Details = ({ text }: { text: string }) => (
  <Disclosure className={styles.detailsText} label='Details'>{text}</Disclosure>
)

/**
 * The rows: a compact list inside the box. With a fold they sit under a disclosure labelled by the
 * CR; without one they are simply shown. The widget has no length threshold: the page decides.
 */
const Rows = ({ fold, mono, rows }: { fold?: RowsFold; mono?: boolean; rows: string[] }) => {
  const list = (
    <ul className={mono ? styles.rowsMono : styles.rows}>
      {rows.map((row, index) => <li key={index}>{row}</li>)}
    </ul>
  )
  return fold
    ? <Disclosure label={fold.label} open={fold.open}>{list}</Disclosure>
    : <div className={styles.rowsBlock}>{list}</div>
}

const Alert = ({ uid, widgetData }: WidgetProps<AlertWidgetData>) => {
  const { description, details, rows, rowsFold, rowsMonospace, tag, ...rest } = widgetData
  const hasRows = rows !== undefined && rows.length > 0

  // None of the optional fields set: antd's Alert exactly as before, with nothing wrapped around
  // title or description.
  if (!tag && !details && !hasRows) {
    return <AntdAlert key={uid} {...rest} description={description} />
  }

  const title = tag
    ? (
      <span className={styles.title}>
        {rest.title}
        <Tag className={styles.tag} style={getTagStyle(paintedType(widgetData))}>{tag}</Tag>
      </span>
    )
    : rest.title

  const body = hasRows || details
    ? (
      <>
        {description}
        {hasRows && <Rows fold={rowsFold} mono={rowsMonospace} rows={rows} />}
        {details && <Details text={details} />}
      </>
    )
    : description

  return <AntdAlert key={uid} {...rest} description={body} title={title} />
}

export default Alert
