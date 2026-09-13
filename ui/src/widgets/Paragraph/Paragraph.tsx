import { Typography } from 'antd'
import Linkify from 'linkify-react'

import type { WidgetProps } from '../../types/Widget'

import { resolveLocalTokens } from './localTokens'
import styles from './Paragraph.module.css'
import type { Paragraph as WidgetType } from './Paragraph.type'

export type ParagraphWidgetData = WidgetType['spec']['widgetData']

const Paragraph = ({ uid, widgetData }: WidgetProps<ParagraphWidgetData>) => {
  const { code, copyable, delete: del, disabled, ellipsis, italic, level, mark, strong, text, type, underline, variant } = widgetData

  // Resolve client-side tokens (currently {localTimeOfDay}) in the browser so they reflect the
  // viewer's local time regardless of snowplow's cached server `now`. See ./localTokens.
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

  // Frontend-only cosmetic hide: the page-header eyebrow ("PLATFORM · TENANT …", "CATALOG ·
  // CURATED", …) is suppressed to drop the redundant third title — the eyebrow-styled breadcrumb
  // carries that context line above the H1 instead.
  //
  // THE CHART SIDE IS NOW DONE. Every `*-eyebrow` Paragraph CR has been deleted from the portal
  // chart by the PageHeader migration — the widget has no eyebrow field and will not grow one, so
  // the count there is zero and stays zero. This block is what is left.
  //
  // Removing it, and the `eyebrow` value from the variant enum with it, is a TWO-STEP change that
  // must happen in this order:
  //
  //   1. the portal chart without eyebrow CRs is DEPLOYED  ← not yet; 057 still runs 1.8.8, which
  //      has 18 of them live
  //   2. THEN the enum value can go
  //
  // Doing step 2 first invalidates those 18 live CRs against the CRD. The chart and the CRD roll
  // independently, so "the repo has none" is not the same as "the cluster has none" — check the
  // cluster, not the chart:
  //
  //   kubectl get paragraphs.widgets.templates.krateo.io -A -o json \
  //     | jq '[.items[] | select(.spec.widgetData.variant == "eyebrow")] | length'
  //
  // Until that returns 0, this block stays and is load-bearing: it is what keeps the deployed
  // eyebrows invisible.
  if (variant === 'eyebrow') {
    return null
  }

  // A `level` promotes the text to a Typography.Title (h1-h5); otherwise it
  // renders as a body Paragraph. Both share the same inline-style props.
  if (level) {
    return (
      <Typography.Title
        className={styles.paragraph}
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
      className={styles.paragraph}
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
