import { Form as AntdForm, AutoComplete, Button, Select } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import type { JSONSchema4 } from 'json-schema'
import { useContext, useMemo } from 'react'

import { type FieldPath, isSecretNode, nodeAt, resolveFieldPath, templateKey } from './fieldDependencies'
import type { FieldOption, FieldOptionsSpec } from './fieldOptions'
import styles from './Form.module.css'
import { SchemaRootContext } from './schemaRoot'
import { fieldLabel } from './schemaRules'
import { type FieldOptionsState, useFieldOptions } from './useFieldOptions'

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
const noteFor = (state: FieldOptionsState | 'waiting', ref: string, parentLabel: string): string | undefined => {
  switch (state) {
    case 'waiting': return `Choose ${parentLabel} first.`
    case 'missing': return `This field's options are not configured (no source "${ref}" in the form).`
    case 'denied': return 'You do not have access to the options for this field.'
    case 'error': return 'The options could not be loaded.'
    default: return undefined
  }
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

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
 *
 * A field whose source is missing or denied is disabled and says why; a failed load says so with
 * a retry, and an open field still takes typed text meanwhile.
 */
const valueAt = (values: unknown, path: FieldPath): unknown =>
  path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string | number, unknown>)[key] : undefined), values)

export const OptionsInput = ({ disabled, fieldPath = [], id, node, onChange, spec, value }: OptionsInputProps): React.ReactNode => {
  const root = useContext(SchemaRootContext)
  const form = AntdForm.useFormInstance()

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
  const extras = useMemo(
    () => (spec.dependsOn && !waiting ? { [spec.dependsOn.param]: parentValue } : undefined),
    [spec.dependsOn, waiting, parentValue],
  )

  const { options, retry, state } = useFieldOptions(spec.ref, extras, !problem && !waiting)
  const unavailable = !!problem || waiting || state === 'missing' || state === 'denied'
  const antdOptions = toAntdOptions(options)
  const common = {
    disabled: disabled || unavailable,
    filterOption,
    id,
    notFoundContent: state === 'loading' && !waiting ? 'Loading…' : 'No matches',
    options: antdOptions,
    style: { width: '100%' },
  }

  let control: React.ReactNode
  if (node.type === 'array') {
    control = (
      <Select
        {...common}
        allowClear
        loading={state === 'loading' && !unavailable}
        mode={spec.closed ? 'multiple' : 'tags'}
        onChange={(next) => { onChange?.(next) }}
        placeholder={spec.closed ? 'Select…' : 'Select or type…'}
        value={value as Array<string | number> | undefined}
      />
    )
  } else if (spec.closed) {
    control = (
      <Select
        {...common}
        allowClear
        loading={state === 'loading' && !unavailable}
        onChange={(next) => { onChange?.(next) }}
        placeholder='Select…'
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
        placeholder='Select or type…'
        value={value as string | undefined}
      />
    )
  }

  const note = problem ? `This field is misconfigured: ${problem}.` : noteFor(waiting ? 'waiting' : state, spec.ref, parentLabel)
  return (
    <>
      {control}
      {note ? (
        <div className={styles.fieldNote} role='status'>
          {note}
          {state === 'error' ? <Button onClick={retry} size='small' type='link'>Retry</Button> : null}
        </div>
      ) : null}
    </>
  )
}
