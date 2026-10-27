import { AutoComplete, Button, Select } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import type { JSONSchema4 } from 'json-schema'

import type { FieldOption, FieldOptionsSpec } from './fieldOptions'
import styles from './Form.module.css'
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
const noteFor = (state: FieldOptionsState, ref: string): string | undefined => {
  switch (state) {
    case 'missing': return `This field's options are not configured (no source "${ref}" in the form).`
    case 'denied': return 'You do not have access to the options for this field.'
    case 'error': return 'The options could not be loaded.'
    default: return undefined
  }
}

interface OptionsInputProps {
  node: JSONSchema4
  spec: FieldOptionsSpec
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
export const OptionsInput = ({ disabled, id, node, onChange, spec, value }: OptionsInputProps): React.ReactNode => {
  const { options, retry, state } = useFieldOptions(spec.ref)
  const unavailable = state === 'missing' || state === 'denied'
  const antdOptions = toAntdOptions(options)
  const common = {
    disabled: disabled || unavailable,
    filterOption,
    id,
    notFoundContent: state === 'loading' ? 'Loading…' : 'No matches',
    options: antdOptions,
    style: { width: '100%' },
  }

  let control: React.ReactNode
  if (node.type === 'array') {
    control = (
      <Select
        {...common}
        allowClear
        loading={state === 'loading'}
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
        loading={state === 'loading'}
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

  const note = noteFor(state, spec.ref)
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
