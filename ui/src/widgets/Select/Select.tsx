import { Button, Form, Select as AntdSelect, type RefSelectProps } from 'antd'
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import type { WidgetProps } from '../../types/Widget'

import styles from './Select.module.css'
import type { Select as WidgetType } from './Select.type'

export type SelectWidgetData = WidgetType['spec']['widgetData']

/**
 * The multi-mode switcher's "all" choice as a VALUE (C1, X4 audit). An empty scope means every
 * project, and the trigger used to say so through antd's placeholder, so "All projects" was drawn
 * in placeholder grey and exposed as a hint rather than as the control's value. While nothing is
 * staged the Select now holds this one entry instead, which renders through `tagRender` like any
 * selection. It never leaves the component: staging strips it, so the URL still carries no
 * `?<queryParam>=` for "all". `*` cannot collide with an option, because a namespace is a DNS label.
 */
const ALL_SCOPE = '*'

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

  // The open switcher panel's keyboard stops, in the order they read on screen: the "All projects"
  // row, the option list, Clear, Apply. The list is antd's combobox input (`selectRef.focus()` lands
  // there), which lives in the trigger while the rest sit in the popup portal, so the browser's own
  // Tab order cannot join them: rc-select's list takes Tab as "select the active option" and
  // prevents it, and the portal is mounted at the end of <body>. Tab / Shift+Tab therefore step
  // through this ring, wrapping at either end while the panel is open; Escape leaves it.
  const selectRef = useRef<RefSelectProps>(null)
  const masterRef = useRef<HTMLButtonElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const applyRef = useRef<HTMLButtonElement>(null)
  const panelStops: RefObject<{ focus: () => void } | null>[] = [masterRef, selectRef, clearRef, applyRef]

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
    const isAll = staged.length === 0
    const allLabel = placeholder ?? 'All projects'
    const multiValue = isAll ? [ALL_SCOPE] : staged
    const value = isMulti ? multiValue : (raw || undefined)
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
    // Picking a project while "all" is the value hands back [ALL_SCOPE, project]; removing the "all"
    // entry hands back []. Both resolve by dropping ALL_SCOPE: the staged set holds projects only.
    const onStage = (next?: string | string[]) => {
      setStaged(([] as string[]).concat(next ?? []).filter((entry) => entry !== ALL_SCOPE))
    }
    // Apply: commit the staged selection to the URL, close the popup and give focus back to the
    // picker (from the keyboard, focus was on Apply, which closing the popup would leave on <body>).
    // That holds while the picker stays mounted. In the portal shell today a changed scope re-keys
    // the root `app-shell` widget (Shell.tsx, INIT in `page` scope), which remounts the header with
    // this picker in it, and the new picker does not hold the focus.
    const apply = () => {
      commit(staged)
      setOpen(false)
      selectRef.current?.focus()
    }

    // Tab / Shift+Tab from panel stop `index` moves to the next / previous stop of the ring.
    const tabFrom = (index: number, event: KeyboardEvent) => {
      event.preventDefault()
      const step = event.shiftKey ? -1 : 1
      panelStops[(index + step + panelStops.length) % panelStops.length].current?.focus()
    }

    // The option list (the combobox input), while the panel is open. Tab is caught here, on the
    // input, before it bubbles to rc-select's root handler, whose list would take it as "toggle the
    // active option". Closed, Tab is left alone and moves on through the page.
    const onListKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (open && event.key === 'Tab') {
        event.stopPropagation()
        tabFrom(panelStops.indexOf(selectRef), event)
      }
    }

    // A panel button: Tab walks the ring; Escape discards the staged selection (closing resyncs
    // `staged` from the URL) and returns focus to the picker, as Escape does from the list.
    const onPanelButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Tab') {
        tabFrom(panelStops.findIndex((stop) => stop.current === event.currentTarget), event)
      } else if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        selectRef.current?.focus()
      }
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
          {/* P19: project names are arbitrary-length and this label truncates. `label` is a
              ReactNode, so it is only usable as a title attribute when it is actually a string —
              String()-ing a node yields "[object Object]", which is worse than no tooltip. */}
          <span className={styles.checkOptionLabel} title={typeof option.label === 'string' ? option.label : String(option.value)}>{option.label ?? String(option.value)}</span>
        </span>
      )
    }

    // the §02 switcher panel, rendered around antd's option `menu`. Its buttons act on click, so
    // Enter / Space work as for any button; their mousedown is prevented only so that a pointer
    // press keeps focus on the list rather than moving it into the panel.
    const keepListFocus = (event: { preventDefault: () => void }) => { event.preventDefault() }
    const renderPanel = (menu: ReactNode) => (
      <div>
        <div className={styles.panelHead}>{label ?? placeholder ?? 'Projects'}</div>
        <button
          className={`${styles.masterRow} ${isAll ? styles.masterOn : ''}`}
          onClick={() => setStaged([])}
          onKeyDown={onPanelButtonKeyDown}
          onMouseDown={keepListFocus}
          ref={masterRef}
          type='button'
        >
          <span className={`${styles.checkBox} ${isAll ? styles.checkBoxOn : ''}`}>{isAll ? '✓' : ''}</span>
          <span className={styles.checkOptionLabel} title={allLabel}>{allLabel}</span>
          <span className={styles.optionCount}>{optionValues.length} ns</span>
        </button>
        <div className={styles.panelHr} />
        {menu}
        <div className={styles.panelApply}>
          {/* Clear stages "all" (setStaged([])) but keeps the popup OPEN so the user can keep
              picking. Apply is "done": it COMMITS the staged selection to the URL and closes the
              popup via the controlled `open` state. It must NOT rely on a native blur to close — in
              antd 6 an in-popup mousedown re-opens the popup (see the `open` state above), which is
              why the old blur-only Apply silently did nothing. */}
          <Button onClick={() => setStaged([])} onKeyDown={onPanelButtonKeyDown} onMouseDown={keepListFocus} ref={clearRef} size='small'>Clear</Button>
          <Button
            onClick={apply}
            onKeyDown={onPanelButtonKeyDown}
            onMouseDown={keepListFocus}
            ref={applyRef}
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
        // The combobox's accessible name: the panel's own heading. The control shows only its value
        // ("All projects", or the picked projects): what is selected, not what the control selects.
        aria-label={label ?? placeholder ?? 'Projects'}
        className={isAll ? `${styles.checkSelect} ${styles.checkSelectAll}` : styles.checkSelect}
        classNames={{ popup: { root: styles.checkPopup } }}
        disabled={disabled}
        key={uid}
        maxTagCount='responsive'
        maxTagPlaceholder={(omitted) => <span className={styles.pill}>+{omitted.length}</span>}
        mode={mode}
        // Stage-only: a toggle updates `staged`, it does NOT touch the URL. Apply commits.
        onChange={onStage}
        onInputKeyDown={onListKeyDown}
        // Own the popup open-state so Apply/Clear can close/keep it deterministically instead of
        // relying on a native blur that antd 6 no longer produces for an in-popup click.
        onOpenChange={setOpen}
        open={open}
        optionRender={renderCheckOption}
        options={options}
        popupMatchSelectWidth={popupWidth}
        popupRender={renderPanel}
        ref={selectRef}
        // #86 §0.1: the leading prefix dot was removed — it read as a stray indicator, and the
        // "All projects" value centres in the control (Select.module.css .allScope).
        // #80 §0.6: this multi-select filters via its custom checkbox popup (popupRender), so antd's
        // inline search input isn't needed. `showSearch={false}` alone does NOT remove it in antd 6
        // multi-mode: the readonly `.ant-select-input` stays, because it is the combobox itself (it
        // takes focus and keyboard input). The `.checkSelect` class above hides only its caret
        // (Select.module.css); the input must stay rendered or the picker leaves the Tab order.
        showSearch={false}
        size={size}
        // #86 §0.2: was a fixed `minWidth: 170` that pinned the switcher to its content width so it
        // couldn't shrink with the header (colliding with the search box at narrow widths). Now a
        // 170px flex-basis that CAN shrink to 0 (the "All projects" value ellipsises) — matching the
        // search trigger's responsive behaviour so the whole left cluster yields together.
        style={{ flex: '0 1 170px', minWidth: 0 }}
        tagRender={(props) => (props.value === ALL_SCOPE ? (
          // The "all" value: plain text in the control, no pill and nothing to remove.
          <span className={styles.allScope} title={allLabel}>{allLabel}</span>
        ) : (
          // C8 exception: not a control; it only stops the mousedown reaching the Select, which would open the dropdown.
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <span className={styles.ptag} onMouseDown={(event) => event.stopPropagation()}>
            {props.label}
            {/* C8: a real button, so the tag can be removed from the keyboard and is named for what it removes. */}
            {props.closable ? (
              <button aria-label={typeof props.label === 'string' ? `Remove ${props.label}` : 'Remove'} className={styles.ptagClose} onClick={props.onClose} type='button'>✕</button>
            ) : null}
          </span>
        ))}
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
