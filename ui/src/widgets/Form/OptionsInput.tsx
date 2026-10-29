import { Form as AntdForm, AutoComplete, Button, Input, InputNumber, Select } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import type { JSONSchema4 } from 'json-schema'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useDebouncedValue } from '../../hooks/useDebouncedValue'

import { type FieldPath, isSecretNode, nodeAt, resolveFieldPath, templateKey } from './fieldDependencies'
import type { FieldOption, FieldOptionsSpec } from './fieldOptions'
import styles from './Form.module.css'
import { SchemaRootContext } from './schemaRoot'
import { fieldLabel } from './schemaRules'
import { type FieldOptionsState, FormRefsContext, useFieldOptions } from './useFieldOptions'

/** How long typing must pause before a search is sent — the palette typeahead's delay. */
export const SEARCH_DEBOUNCE_MS = 300

/** Text matched when the person filters the list: the label, the value and the description. */
const searchText = (option: FieldOption): string =>
  [option.label, String(option.value), option.description ?? ''].join(' ').toLowerCase()

const toAntdOptions = (options: FieldOption[]): DefaultOptionType[] => options.map((option) => ({
  label: (
    <span className={styles.optionLabel}>
      <span className={styles.optionMain}>{option.label}</span>
      {option.description ? <span className={styles.optionDesc}>{option.description}</span> : null}
    </span>
  ),
  title: searchText(option),
  value: option.value as string | number,
}))

const filterOption = (input: string, option?: DefaultOptionType): boolean =>
  typeof option?.title === 'string' && option.title.includes(input.trim().toLowerCase())

/** What the field says under the control when its options cannot be shown. */
const noteFor = (state: FieldOptionsState | 'waiting' | 'empty', ref: string, parentLabel: string, typeable: boolean): string | undefined => {
  switch (state) {
    case 'waiting': return `Choose ${parentLabel} first.`
    case 'missing': return `This field's options are not configured (no source "${ref}" in the form).`
    case 'denied': return 'You do not have access to the options for this field.'
    case 'error': return typeable ? 'The options could not be loaded. You can type the value.' : 'The options could not be loaded.'
    case 'empty': return 'No options are available right now. You can type the value.'
    default: return undefined
  }
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

const valueAt = (values: unknown, path: FieldPath): unknown =>
  path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string | number, unknown>)[key] : undefined), values)

const optionKey = (value: unknown): string => `${typeof value}:${String(value)}`

interface OptionsInputProps {
  node: JSONSchema4
  spec: FieldOptionsSpec
  /** the field's ABSOLUTE path; `dependsOn.field` is relative to the object that holds it */
  fieldPath?: FieldPath
  id?: string
  value?: unknown
  onChange?: (next: unknown) => void
  disabled?: boolean
}

/**
 * The control of a field with `x-krateo-options`: the list a RESTAction returns, as a Select when
 * the list is CLOSED and as an AutoComplete (free text that happens to suggest) when it is open.
 * An array field picks several — `multiple` when closed, `tags` when open.
 *
 * The field stores the option's VALUE only, never the `{ label, value }` pair: the schema types
 * the field as the value, and the payload, the Review, drafts and Autopilot all read it as such.
 * The labels it showed are recorded with the Form (OptionRegistry) for the Review to show.
 *
 * With `search`, what the person types is sent to the RESTAction (debounced, from `minChars`
 * characters) and the RESTAction filters; without it the list loads once and filters here.
 *
 * A field whose source is missing or denied is disabled and says why; a failed load says so with
 * a retry, and an open field still takes typed text meanwhile.
 */
export const OptionsInput = ({ disabled, fieldPath = [], id, node, onChange, spec, value }: OptionsInputProps): React.ReactNode => {
  const root = useContext(SchemaRootContext)
  const { options: registry } = useContext(FormRefsContext)
  const form = AntdForm.useFormInstance()
  const pathKey = JSON.stringify(fieldPath)

  // DEPENDENCIES. The options are fetched with the parent field's value as `extras[param]`, and
  // not at all while it is empty: the field waits, and says what it waits for. A dependency the
  // form cannot honour — a secret parent (its value would travel in a URL, a log line and a cache
  // key), a cycle, a malformed spec — disables the field with the reason, instead of calling.
  const parentPath = spec.dependsOn ? resolveFieldPath(spec.dependsOn.field, fieldPath.slice(0, -1)) : undefined
  const parentNode = parentPath ? nodeAt(root?.schema, parentPath) : undefined
  const parentKey = parentPath?.[parentPath.length - 1]
  const parentLabel = parentNode ? fieldLabel(String(parentKey), parentNode) : String(parentKey ?? '')
  let { problem } = spec
  if (!problem && parentPath && isSecretNode(parentNode)) {
    problem = `options cannot depend on ${parentLabel}: it is a secret`
  }
  if (!problem && parentPath && root?.cyclic.has(templateKey(fieldPath))) {
    problem = 'its options depend on themselves through dependsOn'
  }
  // A selector, so a field with no dependency (or an unchanged parent) does not re-render on
  // every keystroke elsewhere in the form: antd re-renders only when the selected value changes.
  const parentValue: unknown = AntdForm.useWatch((values: unknown) => (parentPath ? valueAt(values, parentPath) : undefined), { form, preserve: true })
  const waiting = !!parentPath && isEmpty(parentValue)

  // SEARCH. An open scalar field searches what it holds (an AutoComplete's value IS the typed
  // text); a Select searches its own input box. A term under `minChars` makes no call: the cache
  // cell snowplow keeps per distinct term is not spent on "a".
  const [typed, setTyped] = useState('')
  const searchesValue = !spec.closed && node.type !== 'array'
  let rawTerm = ''
  if (spec.search && !searchesValue) {
    rawTerm = typed
  } else if (spec.search && typeof value === 'string') {
    rawTerm = value
  }
  const term = useDebouncedValue(rawTerm.trim(), SEARCH_DEBOUNCE_MS)
  const tooShort = !!spec.search && term.length < spec.search.minChars

  const extras = useMemo(() => {
    const next: Record<string, unknown> = {}
    if (spec.dependsOn && !waiting) { next[spec.dependsOn.param] = parentValue }
    if (spec.search && !tooShort) { next[spec.search.param] = term }
    return Object.keys(next).length ? next : undefined
  }, [spec.dependsOn, spec.search, waiting, parentValue, tooShort, term])

  const { options, retry, state } = useFieldOptions(spec.ref, extras, !problem && !waiting && !tooShort)
  const unavailable = !!problem || waiting || state === 'missing' || state === 'denied'
  const ready = state === 'ready' && !waiting && !tooShort && !problem

  // Every option the field has shown, so a picked value keeps its label once a new search
  // replaces the list — and the Review can show it.
  const seen = useRef(new Map<string, FieldOption>())
  useEffect(() => {
    if (!ready) { return }
    for (const option of options) { seen.current.set(optionKey(option.value), option) }
    registry?.record(JSON.parse(pathKey) as FieldPath, options)
  }, [ready, options, registry, pathKey])

  // A CLOSED list known in full (loaded at once, not searched) is what the field's value is
  // validated against; once it arrives, a value that came some other way and is not in it is
  // flagged right away rather than at submit.
  // MANUAL FALLBACK (`fallback: "manual"`). A closed field whose source failed, timed out, or
  // answered an empty list in full takes typed text instead of blocking the form: an empty
  // Select cannot be filled. A search that finds nothing is not this — that list is not "in full".
  const emptyInFull = ready && !spec.search && options.length === 0
  const manual = spec.closed && spec.fallback === 'manual' && !unavailable && (state === 'error' || emptyInFull)

  const knownInFull = ready && spec.closed && !spec.search && !manual
  useEffect(() => {
    const path = JSON.parse(pathKey) as FieldPath
    registry?.setClosed(path, knownInFull ? options : undefined)
    if (knownInFull && !isEmpty(form.getFieldValue(path))) {
      form.validateFields([path]).catch(() => undefined)
    }
    return () => { registry?.setClosed(path, undefined) }
  }, [knownInFull, options, registry, pathKey, form])

  const picked = (Array.isArray(value) ? value : [value]).filter((entry) => !isEmpty(entry))
  const listed = new Set(options.map((option) => optionKey(option.value)))
  const keptPicks = picked
    .filter((entry) => !listed.has(optionKey(entry)))
    .map((entry) => seen.current.get(optionKey(entry)))
    .filter((option): option is FieldOption => !!option)
  const antdOptions = toAntdOptions([...keptPicks, ...options])

  let notFoundContent = 'No matches'
  if (spec.search && tooShort) {
    notFoundContent = `Type at least ${spec.search.minChars} characters to search`
  } else if (state === 'loading' && !unavailable) {
    notFoundContent = 'Loading…'
  }
  const common = {
    disabled: disabled || unavailable,
    // A search is filtered by the RESTAction: filtering its answer again here would hide what it
    // matched on a field the label does not show.
    filterOption: spec.search ? false : filterOption,
    id,
    notFoundContent,
    options: antdOptions,
    style: { width: '100%' },
  }
  const onSearch = spec.search && !searchesValue ? setTyped : undefined
  const loading = state === 'loading' && !unavailable && !tooShort

  let control: React.ReactNode
  if (manual && node.type === 'array') {
    control = (
      <Select
        allowClear
        disabled={disabled}
        id={id}
        mode='tags'
        notFoundContent={null}
        onChange={(next) => { onChange?.(next) }}
        placeholder='Type values…'
        style={{ width: '100%' }}
        value={value as Array<string | number> | undefined}
      />
    )
  } else if (manual && (node.type === 'integer' || node.type === 'number')) {
    control = (
      <InputNumber
        disabled={disabled}
        id={id}
        onChange={(next) => { onChange?.(next ?? undefined) }}
        placeholder='Type the value…'
        style={{ width: '100%' }}
        value={typeof value === 'number' ? value : undefined}
      />
    )
  } else if (manual) {
    control = (
      <Input
        allowClear
        disabled={disabled}
        id={id}
        onChange={(event) => { onChange?.(event.target.value || undefined) }}
        placeholder='Type the value…'
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
      />
    )
  } else if (node.type === 'array') {
    control = (
      <Select
        {...common}
        allowClear
        loading={loading}
        mode={spec.closed ? 'multiple' : 'tags'}
        onChange={(next) => { onChange?.(next) }}
        onSearch={onSearch}
        placeholder={spec.closed ? 'Select…' : 'Select or type…'}
        value={value as Array<string | number> | undefined}
      />
    )
  } else if (spec.closed) {
    control = (
      <Select
        {...common}
        allowClear
        loading={loading}
        onChange={(next) => { onChange?.(next) }}
        onSearch={onSearch}
        placeholder={spec.search ? 'Type to search…' : 'Select…'}
        showSearch
        value={value as string | number | undefined}
      />
    )
  } else {
    control = (
      <AutoComplete
        {...common}
        allowClear
        onChange={(next) => { onChange?.(next) }}
        placeholder={spec.search ? 'Type to search…' : 'Select or type…'}
        value={value as string | undefined}
      />
    )
  }

  let noteState: FieldOptionsState | 'waiting' | 'empty' = state
  if (waiting) {
    noteState = 'waiting'
  } else if (manual && emptyInFull) {
    noteState = 'empty'
  }
  // An open field takes typed text whatever its source does; a closed one only in manual fallback.
  const typeable = manual || !spec.closed
  const note = problem ? `This field is misconfigured: ${problem}.` : noteFor(noteState, spec.ref, parentLabel, typeable)
  return (
    <>
      {control}
      {note ? (
        <div className={styles.fieldNote} role='status'>
          {note}
          {state === 'error' || noteState === 'empty' ? <Button onClick={retry} size='small' type='link'>Retry</Button> : null}
        </div>
      ) : null}
    </>
  )
}
