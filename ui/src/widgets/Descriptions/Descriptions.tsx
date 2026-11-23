import { Descriptions as AntdDescriptions } from 'antd'

import { DataLink } from '../../components/AppLink/AppLink'
import type { WidgetProps } from '../../types/Widget'

import styles from './Descriptions.module.css'
import type { Descriptions as WidgetType } from './Descriptions.type'

export type DescriptionsWidgetData = WidgetType['spec']['widgetData']

/** An item's value, a link when the item has an `href` (components/AppLink: in-app via the router). */
const valueOf = (value: string, href: string | undefined) => (href ? <DataLink href={href}>{value}</DataLink> : value)

const Descriptions = ({ uid, widgetData }: WidgetProps<DescriptionsWidgetData>) => {
  const { bordered, column, items, size, title, variant } = widgetData

  // `variant: form` — render a read-only mirror of the create Form's property layout: each item is
  // a connector-rail field (bold label above a mono value), grouped into SECTIONS by `item.section`
  // (a nested object's top-level key becomes its own labelled section; the ungrouped top section has
  // no header). Sections + items keep their first-seen (document) order.
  if (variant === 'form') {
    const order: string[] = []
    const groups: Record<string, { href?: string; label: string; value: string }[]> = {}
    items.forEach((item) => {
      const section = item.section ?? ''
      if (!groups[section]) {
        groups[section] = []
        order.push(section)
      }
      groups[section].push({ href: item.href, label: item.label, value: item.value })
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
                <span className={styles.fieldValue}>{property.value ? valueOf(property.value, property.href) : '—'}</span>
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
      items={items.map(({ href, label, span, value }, index) => ({
        children: valueOf(value, href),
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
