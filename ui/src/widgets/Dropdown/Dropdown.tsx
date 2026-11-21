import { EllipsisOutlined } from '@ant-design/icons'
import { Button, Dropdown as AntdDropdown } from 'antd'
import { useState } from 'react'

import WidgetRenderer from '../../components/WidgetRenderer'
import type { WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'

import styles from './Dropdown.module.css'
import type { Dropdown as WidgetType } from './Dropdown.type'

export type DropdownWidgetData = WidgetType['spec']['widgetData']

/**
 * An overflow menu: a compact "⋯" trigger that opens the actions it holds (the composition detail
 * header's Pause and Delete, approved redesign). Faithful to antd `Dropdown` with `popupRender`: the
 * items are the REAL Button widgets, rendered in a column, so each keeps its action, its
 * confirmation (an app-level modal, so closing the menu does not cancel it) and its permission
 * behaviour (a denied Button renders nothing, as anywhere else).
 *
 * The menu closes when an item is clicked. antd keeps a closed menu's content mounted, so a Button
 * whose action is still running is not unmounted under it.
 */
const Dropdown = ({ resourcesRefs, uid, widgetData }: WidgetProps<DropdownWidgetData>) => {
  const { ariaLabel, items, label, placement } = widgetData
  const [open, setOpen] = useState(false)

  const children = items
    .map(({ resourceRefId }, index) => {
      const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)
      return endpoint ? <WidgetRenderer key={`${uid}-${index}`} widgetEndpoint={endpoint} /> : null
    })
    .filter(Boolean)

  if (!children.length) {
    return null
  }

  return (
    <AntdDropdown
      onOpenChange={setOpen}
      open={open}
      placement={placement ?? 'bottomRight'}
      popupRender={() => (
        <div
          className={styles.panel}
          onClick={() => { setOpen(false) }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false) } }}
          role='menu'
          tabIndex={-1}
        >
          {children}
        </div>
      )}
      trigger={['click']}
    >
      <Button aria-label={ariaLabel} icon={<EllipsisOutlined />} title={ariaLabel}>
        {label}
      </Button>
    </AntdDropdown>
  )
}

export default Dropdown
