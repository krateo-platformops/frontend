import { Descriptions as AntdDescriptions } from 'antd'

import { DataLink } from '../../components/AppLink/AppLink'
import TimeText from '../../components/TimeText'
import type { WidgetProps } from '../../types/Widget'

import styles from './Descriptions.module.css'
import type { Descriptions as WidgetType } from './Descriptions.type'

export type DescriptionsWidgetData = WidgetType['spec']['widgetData']

type Item = DescriptionsWidgetData['items'][number]

/**
 * An item's value: in its time form when the item has a `format` (utils/dateFormat, full date on hover
 * and focus), and a link when it has an `href` (components/AppLink: in-app via the router).
 */
const valueOf = ({ format, href, value }: Pick<Item, 'format' | 'href' | 'value'>) => {
  const text = format ? <TimeText form={format} value={value} /> : value
  return href ? <DataLink href={href}>{text}</DataLink> : text
}

const Descriptions = ({ uid, widgetData }: WidgetProps<DescriptionsWidgetData>) => {
  const { bordered, column, items, size, title, variant } = widgetData

  // `variant: form` — render a read-only mirror of the create Form's property layout: each item is
  // a connector-rail field (bold label above a mono value), grouped into SECTIONS by `item.section`
  // (a nested object's top-level key becomes its own labelled section; the ungrouped top section has
  // no header). Sections + items keep their first-seen (document) order.
  if (variant === 'form') {
    const order: string[] = []
    const groups: Record<string, Pick<Item, 'format' | 'href' | 'label' | 'value'>[]> = {}
    items.forEach((item) => {
      const section = item.section ?? ''
      if (!groups[section]) {
        groups[section] = []
        order.push(section)
      }
      groups[section].push({ format: item.format, href: item.href, label: item.label, value: item.value })
    })
    // The ungrouped top section ('') always leads (mirrors the Form's "Top-level values" first),
    // then the named sections in first-seen order.
    const ordered = order.includes('') ? ['', ...order.filter((section) => section !== '')] : order

    return (
      <div className={styles.formView} key={uid}>
        {ordered.map((section) => (
          <section className={styles.section} key={section || '__top'}>
            {section ? <div className={styles.sectionTitle}>{section}</div> : null}
            {(groups[section] ?? []).map((property, index) => (
              <div className={styles.field} key={`${section}-${index}`}>
                <span className={styles.fieldLabel}>{property.label}</span>
                <span className={styles.fieldValue}>{property.value ? valueOf(property) : '—'}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    )
  }

  return (
    <AntdDescriptions
      bordered={bordered}
      column={column}
      items={items.map(({ format, href, label, span, value }, index) => ({
        children: valueOf({ format, href, value }),
        key: String(index),
        label,
        span,
      }))}
      key={uid}
      size={size}
      title={title}
    />
  )
}

export default Descriptions
