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
  // THE PAGE-HEADER eyebrows are gone — every `*-eyebrow` Paragraph the PageHeader migration
  // touched has been deleted from the portal chart, and the widget has no eyebrow field and will
  // not grow one.
  //
  // BUT THE VARIANT IS STILL IN USE, and not by a page header: `obs-limit-label` and
  // `obs-range-label` are observability BODY labels that render in eyebrow style on purpose. So
  // the enum value stays. Removing it is not "delete the last page-header eyebrow", it is "decide
  // what those two labels should be instead" — a separate question, and nobody has answered it.
  //
  // If that question is ever answered, the order still matters: the chart must be DEPLOYED without
  // them before the enum value goes, or the live CRs fail validation. The chart and the CRD roll
  // independently, so "the repo has none" is not "the cluster has none".
  //
  // AND THE OBVIOUS CLUSTER QUERY LIES. This comment used to carry the naive form, and it would
  // never have reached zero:
  //
  //   kubectl get paragraphs.widgets.templates.krateo.io -A -o json \
  //     | jq '[.items[] | select(.spec.widgetData.variant == "eyebrow")] | length'     # → 3
  //
  // One of those three is `agents-policy-create-eyebrow`, an ORPHAN. The Portal composition gets a
  // NEW `krateo.io/composition-id` on every version bump, and CRs the new chart no longer renders
  // are left behind under the old id with no ownerReference to garbage-collect them — 9 such CRs
  // were stranded across three composition instances (v1-8-8, v1-8-9, v1-8-10) at the time of
  // writing. They are inert, but they answer cluster-state questions wrongly forever.
  //
  // Scope the query to the LIVE composition, which is the only thing the chart controls:
  //
  //   CID=$(kubectl get pageheaders.widgets.templates.krateo.io -n krateo-system \
  //     alerts-page-header -o jsonpath='{.metadata.labels.krateo\.io/composition-id}')
  //   kubectl get paragraphs.widgets.templates.krateo.io -A -l krateo.io/composition-id=$CID \
  //     -o json | jq '[.items[] | select(.spec.widgetData.variant == "eyebrow")] | length'   # → 2
  //
  // Until THAT returns 0, this block stays and is load-bearing: it is what keeps the eyebrow-styled
  // labels rendering as nothing... which is itself the thing to reconsider, because those two
  // observability labels presumably want to be VISIBLE.
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
