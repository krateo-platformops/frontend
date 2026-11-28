import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Segmented as AntdSegmented } from 'antd'
import { useSearchParams } from 'react-router'

import type { WidgetProps } from '../../types/Widget'

import styles from './Segmented.module.css'
import type { Segmented as WidgetType } from './Segmented.type'

export type SegmentedWidgetData = WidgetType['spec']['widgetData']
type SegmentedOption = SegmentedWidgetData['options'][number]

/** An option's label: its text, or for an icon-only segment the icon, named by its tooltip. */
const labelOf = ({ icon, label, tooltip, value }: SegmentedOption) => {
  const text = label ?? value
  if (!icon) { return text }
  const glyph = <FontAwesomeIcon fixedWidth icon={icon as IconProp} />
  return text
    ? <>{glyph} {text}</>
    : <span aria-label={tooltip ?? value} role='img'>{glyph}</span>
}

/**
 * antd `Segmented` bound to URL state (NOT a Form control), for a choice that switches the VIEW
 * of a page: a range, a layout, a scope.
 *
 * The choice lives in `?<queryParam>=`, the URL→extras channel the URL-bound Select and RangePicker
 * use, so a data source reads it server-side, a link names it, and back/forward move through it.
 * Every other param on the URL is kept. The default choice is the URL WITHOUT the param: choosing
 * it removes the param, so the page's plain address stays its default.
 *
 * A value on the URL that no option names selects no segment: the page is showing something the
 * control cannot say, and highlighting the default instead would claim the wrong one.
 *
 * For a choice that is a form field, Radio with `optionType: button` draws the same control.
 */
const Segmented = ({ uid, widgetData }: WidgetProps<SegmentedWidgetData>) => {
  const { ariaLabel, block, defaultValue, disabled, options, queryParam, shape, size, vertical } = widgetData
  const [searchParams, setSearchParams] = useSearchParams()

  const fallback = defaultValue ?? options[0]?.value
  const value = searchParams.get(queryParam) ?? fallback

  const onChange = (next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next === fallback) {
        params.delete(queryParam)
      } else {
        params.set(queryParam, next)
      }
      return params
    })
  }

  return (
    <AntdSegmented<string>
      aria-label={ariaLabel}
      block={block}
      className={block ? undefined : styles.fit}
      disabled={disabled}
      key={uid}
      onChange={onChange}
      options={options.map((option) => ({
        disabled: option.disabled,
        label: labelOf(option),
        tooltip: option.tooltip,
        value: option.value,
      }))}
      shape={shape}
      size={size}
      value={value}
      vertical={vertical}
    />
  )
}

export default Segmented
