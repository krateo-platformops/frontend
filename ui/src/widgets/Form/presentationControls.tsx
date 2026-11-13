import { Input, Select } from 'antd'
import type { JSONSchema4 } from 'json-schema'

import { TEXTAREA_KEY } from './fieldKeys'
import { labelledOptionsOf } from './labelledOptions'

/** A `textareas` entry on a field (written by fieldConfig.ts): its rows, when the CR gives them. */
export const textareaOf = (node: JSONSchema4): { rows?: number } | undefined => {
  const raw: unknown = node[TEXTAREA_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { rows?: number } : undefined
}

const DEFAULT_TEXTAREA_ROWS = 3

/**
 * The control a field gets from an opt-in presentation, or undefined to fall through to the
 * schema's own (SchemaFields `controlFor`):
 *
 * - LABELLED OPTIONS (labelledOptions.ts): a `oneOf` of `{const, title}` is a closed, searchable
 *   Select showing the titles and holding the consts — the same Select an `enum` gets, with labels.
 * - `textareas`: a string drawn as a multi-line TextArea, `rows` high (3 by default).
 */
export const presentationControlFor = (node: JSONSchema4): React.ReactNode => {
  const labelled = labelledOptionsOf(node)
  if (labelled) {
    return <Select allowClear optionFilterProp='label' options={labelled} placeholder='Select…' showSearch style={{ width: '100%' }} />
  }
  const textarea = textareaOf(node)
  if (textarea) {
    return <Input.TextArea rows={textarea.rows ?? DEFAULT_TEXTAREA_ROWS} />
  }
  return undefined
}
