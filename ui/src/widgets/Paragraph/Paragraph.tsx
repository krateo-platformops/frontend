import { Typography } from 'antd'
import Linkify from 'linkify-react'

import type { WidgetProps } from '../../types/Widget'
import { resolveLocalTokens } from '../../utils/localTokens'

import styles from './Paragraph.module.css'
import type { Paragraph as WidgetType } from './Paragraph.type'

export type ParagraphWidgetData = WidgetType['spec']['widgetData']

const Paragraph = ({ uid, widgetData }: WidgetProps<ParagraphWidgetData>) => {
  const { code, copyable, delete: del, disabled, ellipsis, italic, level, mark, strong, text, type, underline, variant } = widgetData

  // Resolve client-side tokens (currently {localTimeOfDay}) in the browser so they reflect the
  // viewer's local time regardless of snowplow's cached server `now`. See utils/localTokens.
  const resolvedText = resolveLocalTokens(text)

  const content = (
    <Linkify
      options={{
        rel: 'noopener noreferrer',
        target: '_blank',
      }}
    >
      {resolvedText}
    </Linkify>
  )

  // `variant: eyebrow` is the small uppercase mono section caption: the label in front of a chip
  // group, or the line above a table. Page-header eyebrows no longer exist (the shell breadcrumb
  // carries that line), so every eyebrow left is a body caption and renders.
  const className = variant === 'eyebrow' ? `${styles.paragraph} ${styles.eyebrow}` : styles.paragraph

  // A `level` promotes the text to a Typography.Title (h1-h5); otherwise it
  // renders as a body Paragraph. Both share the same inline-style props.
  if (level) {
    return (
      <Typography.Title
        className={className}
        code={code}
        copyable={copyable}
        delete={del}
        disabled={disabled}
        ellipsis={ellipsis}
        italic={italic}
        key={uid}
        level={level}
        mark={mark}
        type={type}
        underline={underline}
      >
        {content}
      </Typography.Title>
    )
  }

  return (
    <Typography.Paragraph
      className={className}
      code={code}
      copyable={copyable}
      delete={del}
      disabled={disabled}
      ellipsis={ellipsis}
      italic={italic}
      key={uid}
      mark={mark}
      strong={strong}
      type={type}
      underline={underline}
    >
      {content}
    </Typography.Paragraph>
  )
}

export default Paragraph
