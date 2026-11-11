import { Tooltip } from 'antd'
import { useState, type ReactNode } from 'react'

import styles from './Table.module.css'

type TableCellTooltipProps = {
  children: ReactNode
  /**
   * The wrapper's box. `block` for content that is itself a block (the `bar` gauge, the
   * `conditions` pills), so a div is not nested in a span; `tag` for an antd Tag, an
   * inline-block whose own ellipsis needs a bounded parent; `inline` for text and icons.
   */
  display: 'block' | 'inline' | 'tag'
  /**
   * The wrapper's accessible name, for content that has no text of its own (an icon, a
   * gauge). Text content names itself, and the tooltip is linked to it as its description.
   */
  label?: { name: string; role: 'group' | 'img' }
  title: string
}

/**
 * A Table cell's explicit `tooltip`: the cell's content in a standard antd Tooltip.
 *
 * The content takes focus so the text is reachable without a mouse (WCAG 2.1.1), and Escape
 * closes it where focus stays (1.4.13), as List's `bar.tooltip` label and ArchitectureStateNode
 * do. Keyboard focus only: a click focuses the wrapper too, but hover has already opened the
 * tooltip, and one opened by the click's focus would stay open after the pointer left. antd
 * links the open tooltip to the wrapper through aria-describedby.
 */
const TableCellTooltip = ({ children, display, label, title }: TableCellTooltipProps) => {
  const [byFocus, setByFocus] = useState(false)
  const [byHover, setByHover] = useState(false)
  const open = byFocus || byHover

  const wrapperProps = {
    'aria-label': label?.name,
    className: display === 'tag' ? styles.tooltipTag : undefined,
    onBlur: () => { setByFocus(false) },
    onFocus: (event: React.FocusEvent<HTMLElement>) => { setByFocus(event.currentTarget.matches(':focus-visible')) },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        setByFocus(false)
        setByHover(false)
      }
    },
    role: label?.role,
    tabIndex: 0,
  }

  return (
    <Tooltip onOpenChange={setByHover} open={open} title={title}>
      {/* C8 exception: not a control. A focusable cell whose only key is Escape, to close the
          text it discloses. */}
      {display === 'block'
        ? <div {...wrapperProps}>{children}</div>
        : <span {...wrapperProps}>{children}</span>}
    </Tooltip>
  )
}

export default TableCellTooltip
