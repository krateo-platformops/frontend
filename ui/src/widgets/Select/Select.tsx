import { Button, Form, Select as AntdSelect } from 'antd'
import { type ReactNode, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import type { WidgetProps } from '../../types/Widget'

import styles from './Select.module.css'
import type { Select as WidgetType } from './Select.type'

export type SelectWidgetData = WidgetType['spec']['widgetData']

/**
 * Faithful wrapper of antd `Select`. Two modes:
 *  • default — a `Form.Item` control bound by `name`, for use inside a `Form`.
 *  • `queryParam` set — a STANDALONE, URL-query-bound filter Select (no Form context),
 *    reading/writing `?<queryParam>=` in the URL — the same URL→extras channel RangePicker and
 *    the range chips use, so a data source can scope server-side (compositions-list reads
 *    `.projects`). In `mode: multiple` it renders the multitenancy mockup's CHECKBOX SWITCHER
 *    panel: header (`label`) → "All projects" master row (`placeholder`) → checkbox option rows
 *    → Clear / Apply → `?<queryParam>=` footer.
 */
const Select = ({ uid, widgetData }: WidgetProps<SelectWidgetData>) => {
  const { allowClear, defaultValue, disabled, label, mode, name, options, placeholder, queryParam, required, size } = widgetData
  const [searchParams, setSearchParams] = useSearchParams()
  // The multi-mode switcher popup owns its own open-state. Previously the panel relied on a bare
  // click on "Apply"/"Clear" NATIVELY blurring the Select to close the popup — but rc-select's
  // BaseSelect (antd 6 / rc-select 1.10.1) calls `triggerOpen(true)` on ANY mousedown INSIDE the
  // popup (BaseSelect onRootMouseDown), so an in-popup click can never blur-close it. Result: the
  // Apply button did nothing (bug: "clicco su Apply, non succede nulla"). Controlling `open` here
  // lets Apply/Clear close (or keep) the popup deterministically instead of hoping for a blur.
  const [open, setOpen] = useState(false)

  // STAGED multi-select: toggles do NOT apply. `staged` is a working copy the user edits while the
  // popup is open; Apply commits it to `?<queryParam>=`, closing without Apply discards it. While the
  // popup is CLOSED, `staged` tracks the applied URL scope (the effect re-syncs it), so the trigger
  // shows the applied projects. This is the fix for "picking a project applied+closed immediately
  // instead of letting me select several, then Apply".
  const [staged, setStaged] = useState<string[]>([])
  const urlRaw = queryParam ? (searchParams.get(queryParam) ?? '') : ''
  useEffect(() => {
    if (!open) { setStaged(urlRaw ? urlRaw.split(',') : []) }
  }, [urlRaw, open])

  if (queryParam) {
    // `mode: multiple` (or `tags`) makes the URL-bound Select a MULTI-select: the value is a
    // comma-joined list in `?<queryParam>=` (a data source reads it as an array). Single mode
    // keeps the scalar param.
    const isMulti = mode === 'multiple' || mode === 'tags'
    const raw = searchParams.get(queryParam) ?? ''
    const optionValues = (options ?? []).map((option) => option.value).filter((entry): entry is string => typeof entry === 'string')
    // Multi model mirrors the mockup's checkbox switcher: an EMPTY selection means "All projects" —
    // the master row is lit and individual boxes reflect the STAGED (working) selection, applied to
    // the URL only on Apply. (Single mode keeps the scalar value, applied immediately.)
    const value = isMulti ? staged : (raw || undefined)
    const isAll = staged.length === 0
    const commit = (selected: string[]) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        // Empty OR every-option-selected both collapse to "all" → clear the param (master lit).
        const all = selected.length === 0 || (optionValues.length > 0 && selected.length >= optionValues.length)
        const joined = all ? '' : selected.join(',')
        if (joined) {
          params.set(queryParam, joined)
        } else {
          params.delete(queryParam)
        }
        return params
      }, { replace: false })
    }
    const onChange = (next?: string | string[]) => {
      if (Array.isArray(next)) {
        commit(next)
      } else {
        commit(next ? [next] : [])
      }
    }
    // Multi-select: toggling a checkbox only STAGES it; nothing is applied until Apply commits the
    // staged set. (Single mode keeps `onChange` above, which applies immediately.)
    const onStage = (next?: string | string[]) => {
      if (Array.isArray(next)) {
        setStaged(next)

        return
      }
      setStaged(next ? [next] : [])
    }
    // Apply: commit the staged selection to the URL and close the popup.
    const apply = () => {
      commit(staged)
      setOpen(false)
    }

    if (!isMulti) {
      return (
        <AntdSelect
          allowClear={allowClear}
          disabled={disabled}
          key={uid}
          onChange={onChange}
          options={options}
          placeholder={placeholder}
          // Let the dropdown grow to fit the longest option (e.g. a long composition Kind) rather
          // than truncate to the compact trigger width.
          popupMatchSelectWidth={false}
          size={size}
          value={value}
        />
      )
    }

    // Popup sized to the LONGEST option label so no namespace name truncates while the header
    // trigger itself stays compact. The option labels render in a MONO font (fixed advance ≈
    // 7.4px/char at 12px), so char-count × width + the checkbox/padding overhead is exact enough.
    const longestLabelChars = Math.max(
      (placeholder ?? '').length,
      0,
      ...(options ?? []).map((option) => String(option.label ?? option.value ?? '').length),
    )
    const popupWidth = Math.min(460, Math.max(220, Math.ceil(longestLabelChars * 7.4) + 90))

    // each option → a checkbox row (left amber-fill box + mono name); antd's default right tick
    // is suppressed by `.checkPopup`. `optionRender` reads the live `staged` for on/off.
    const renderCheckOption = (option: { label?: ReactNode; value?: number | string }) => {
      const checked = staged.includes(String(option.value))
      return (
        <span className={styles.checkOption}>
          <span className={`${styles.checkBox} ${checked ? styles.checkBoxOn : ''}`}>{checked ? '✓' : ''}</span>
          <span className={styles.checkOptionLabel}>{option.label ?? String(option.value)}</span>
        </span>
      )
    }

    // the §02 switcher panel, rendered around antd's option `menu`. Interactive bits use
    // onMouseDown + preventDefault so the click doesn't blur/close the popup.
    const renderPanel = (menu: ReactNode) => (
      <div>
        <div className={styles.panelHead}>{label ?? placeholder ?? 'Projects'}</div>
        <button
          className={`${styles.masterRow} ${isAll ? styles.masterOn : ''}`}
          onMouseDown={(event) => { event.preventDefault(); setStaged([]) }}
          type='button'
        >
          <span className={`${styles.checkBox} ${isAll ? styles.checkBoxOn : ''}`}>{isAll ? '✓' : ''}</span>
          <span className={styles.checkOptionLabel}>{placeholder ?? 'All projects'}</span>
          <span className={styles.optionCount}>{optionValues.length} ns</span>
        </button>
        <div className={styles.panelHr} />
        {menu}
        <div className={styles.panelApply}>
          {/* Clear stages "all" (setStaged([])) but keeps the popup OPEN so the user can keep
              picking — preventDefault stops the mousedown from stealing focus mid-interaction.
              Apply is "done": it COMMITS the staged selection to the URL and closes the popup via
              the controlled `open` state. It must NOT rely on a native blur to close — in antd 6 an
              in-popup mousedown re-opens the popup (see the `open` state above), which is why the
              old blur-only Apply silently did nothing. */}
          <Button onMouseDown={(event) => { event.preventDefault(); setStaged([]) }} size='small'>Clear</Button>
          <Button
            onMouseDown={(event) => { event.preventDefault(); apply() }}
            size='small'
            type='primary'
          >
            {isAll ? 'Apply' : `Apply · ${staged.length}`}
          </Button>
        </div>
        <div className={styles.panelFoot}>scope persists across pages via <b>?{queryParam}=</b></div>
      </div>
    )

    return (
      <AntdSelect
        className={styles.checkSelect}
        classNames={{ popup: { root: styles.checkPopup } }}
        disabled={disabled}
        key={uid}
        maxTagCount='responsive'
        maxTagPlaceholder={(omitted) => <span className={styles.pill}>+{omitted.length}</span>}
        mode={mode}
        // Stage-only: a toggle updates `staged`, it does NOT touch the URL. Apply commits.
        onChange={onStage}
        // Own the popup open-state so Apply/Clear can close/keep it deterministically instead of
        // relying on a native blur that antd 6 no longer produces for an in-popup click.
        onOpenChange={setOpen}
        open={open}
        optionRender={renderCheckOption}
        options={options}
        placeholder={placeholder}
        popupMatchSelectWidth={popupWidth}
        popupRender={renderPanel}
        // #86 §0.1: the leading prefix dot was removed — it read as a stray indicator, and the
        // "All projects" placeholder now centres in the control (Select.module.css .checkSelect).
        // #80 §0.6: this multi-select filters via its custom checkbox popup (popupRender), so antd's
        // inline search input isn't needed. `showSearch={false}` alone does NOT remove it in antd 6
        // multi-mode (the readonly `.ant-select-input` stays and blinks a text caret), so the
        // `.checkSelect` class above pairs it with a CSS rule hiding that input (Select.module.css).
        showSearch={false}
        size={size}
        // #86 §0.2: was a fixed `minWidth: 170` that pinned the switcher to its content width so it
        // couldn't shrink with the header (colliding with the search box at narrow widths). Now a
        // 170px flex-basis that CAN shrink to 0 (the placeholder ellipsises) — matching the search
        // trigger's responsive behaviour so the whole left cluster yields together.
        style={{ flex: '0 1 170px', minWidth: 0 }}
        tagRender={(props) => (
          <span className={styles.ptag} onMouseDown={(event) => event.stopPropagation()}>
            {props.label}
            {props.closable ? <span className={styles.ptagClose} onClick={props.onClose} role='button'>✕</span> : null}
          </span>
        )}
        value={value}
      />
    )
  }

  return (
    <Form.Item
      initialValue={defaultValue}
      key={uid}
      label={label}
      name={name}
      rules={required ? [{ message: `${label ?? name} is required`, required: true }] : undefined}
    >
      <AntdSelect
        allowClear={allowClear}
        disabled={disabled}
        mode={mode}
        options={options}
        placeholder={placeholder}
        size={size}
        // #78 (reiteration 4): inside a Form.Item the antd Select defaults to its content width, so a
        // long option label (e.g. a "Chart version" like `1.2.3-rc.1`) pushed it past its grid column
        // and overlapped the neighbour. Pin it to fill the column; the Form.Item / Col bounds the width.
        style={{ width: '100%' }}
      />
    </Form.Item>
  )
}

export default Select
