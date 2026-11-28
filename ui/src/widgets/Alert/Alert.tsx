import { RightOutlined } from '@ant-design/icons'
import { Alert as AntdAlert, Button, Tag } from 'antd'
import { useId, useState } from 'react'

import { withTimeTokens } from '../../components/TimeText/withTimeTokens'
import { getTagStyle } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import styles from './Alert.module.css'
import type { Alert as WidgetType } from './Alert.type'

export type AlertWidgetData = WidgetType['spec']['widgetData']

type AlertType = NonNullable<AlertWidgetData['type']>

/**
 * The type antd paints when the CR names none: a banner is a warning, anything else is info. The
 * tag takes the same colour as the box it sits in, so it has to know which one antd chose.
 */
const paintedType = ({ banner, type }: AlertWidgetData): AlertType => type ?? (banner ? 'warning' : 'info')

/**
 * The message behind the alert, folded away under "Details": the title (and its tag) says what
 * happened, the details say exactly what the server answered. Plain text, line breaks kept, in the
 * alert's own body text once open. A real button, so it is reached by Tab and toggled by Enter or
 * Space, and `aria-expanded` announces which way it is; the chevron is aria-hidden so the button's
 * name is the one word "Details".
 */
const Details = ({ text }: { text: string }) => {
  const id = useId()
  const [open, setOpen] = useState(false)
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
        Details
      </Button>
      <div className={styles.detailsText} hidden={!open} id={id}>{text}</div>
    </div>
  )
}

// `title` and `description` may carry time tokens ({ago:<ISO>}…, components/TimeText/withTimeTokens), written
// in the browser in the viewer's zone. Text without one is passed through as the same string.
const Alert = ({ uid, widgetData }: WidgetProps<AlertWidgetData>) => {
  const { description: rawDescription, details, tag, ...rest } = widgetData
  const description = withTimeTokens(rawDescription)

  // Neither new field set: antd's Alert exactly as before, with nothing wrapped around title or
  // description.
  if (!tag && !details) {
    return <AntdAlert key={uid} {...rest} description={description} title={withTimeTokens(rest.title)} />
  }

  const title = tag
    ? (
      <span className={styles.title}>
        {withTimeTokens(rest.title)}
        <Tag className={styles.tag} style={getTagStyle(paintedType(widgetData))}>{tag}</Tag>
      </span>
    )
    : withTimeTokens(rest.title)

  const body = details
    ? (
      <>
        {description}
        <Details text={details} />
      </>
    )
    : description

  return <AntdAlert key={uid} {...rest} description={body} title={title} />
}

export default Alert
