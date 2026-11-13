import type { JSONSchema4 } from 'json-schema'

import { isSecretSchemaNode } from '../../utils/secretFields'

import { INPUT_KEY } from './fieldKeys'

/**
 * `fieldInputs`: a field's input — its placeholder, its HTML input type and its autocomplete token.
 *
 * ```yaml
 * fieldInputs:
 *   - { name: email, type: email, autoComplete: email, placeholder: jane@example.com }
 *   - { name: phone, type: tel, autoComplete: tel, placeholder: "+39 …" }
 *   - { name: country, placeholder: Search for your country }
 *   - { name: username, autoComplete: username, spellCheck: false, autoCapitalize: none }
 * ```
 *
 * `placeholder` applies to a text Input, a TextArea and an enum or labelled-options Select (in
 * place of "Select…"); `type` to a text Input; `autoComplete`, `spellCheck` and `autoCapitalize`
 * to a text Input and a TextArea. An
 * entry naming a group, a list, a boolean, a number or a secret field is skipped (fieldConfig.ts):
 * a secret field is always `new-password`, so no CR can ask a browser to fill a stored credential.
 */

/** The HTML input types a text field may take: the ones that only change the keyboard and autofill. */
export const INPUT_TYPES = ['text', 'email', 'tel', 'url'] as const
export type InputType = typeof INPUT_TYPES[number]

/**
 * The `autocomplete` tokens a field may carry: the autofill field names of the HTML standard
 * (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill) plus `on` and
 * `off`, WITHOUT the credential tokens (`current-password`, `new-password`, `one-time-code`,
 * `webauthn`) and the payment ones (`cc-*`, `transaction-*`). One token, no section or
 * shipping/billing prefix. Form.schema.json carries the same list as the CRD's enum
 * (fieldInputs.test.ts holds them equal).
 */
export const AUTOCOMPLETE_TOKENS = [
  'off', 'on',
  'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix', 'nickname',
  'username',
  'organization-title', 'organization',
  'street-address', 'address-line1', 'address-line2', 'address-line3',
  'address-level4', 'address-level3', 'address-level2', 'address-level1',
  'country', 'country-name', 'postal-code',
  'language', 'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo',
  'email', 'impp',
  'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-extension',
] as const

/** The `autocapitalize` values a field may take (HTML's, without the `on`/`off` aliases). */
export const AUTOCAPITALIZE_VALUES = ['none', 'sentences', 'words', 'characters'] as const
export type AutoCapitalize = typeof AUTOCAPITALIZE_VALUES[number]

export interface FieldInput {
  autoCapitalize?: AutoCapitalize
  autoComplete?: string
  placeholder?: string
  spellCheck?: boolean
  type?: InputType
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Whether `fieldInputs` can apply to a node: a string-valued leaf that is not a secret. */
export const takesFieldInput = (node: JSONSchema4): boolean =>
  !isSecretSchemaNode(node) && node.type !== 'object' && node.type !== 'array' && node.type !== 'boolean'
  && node.type !== 'number' && node.type !== 'integer'

/** A `fieldInputs` entry as the node carries it, or undefined when it says nothing valid. */
export const fieldInputOf = (entry: Record<string, unknown>): FieldInput | undefined => {
  const input: FieldInput = {}
  if (typeof entry.placeholder === 'string' && entry.placeholder.trim()) { input.placeholder = entry.placeholder }
  if (typeof entry.type === 'string' && (INPUT_TYPES as readonly string[]).includes(entry.type)) { input.type = entry.type as InputType }
  if (typeof entry.autoComplete === 'string' && (AUTOCOMPLETE_TOKENS as readonly string[]).includes(entry.autoComplete)) { input.autoComplete = entry.autoComplete }
  if (typeof entry.spellCheck === 'boolean') { input.spellCheck = entry.spellCheck }
  if (typeof entry.autoCapitalize === 'string' && (AUTOCAPITALIZE_VALUES as readonly string[]).includes(entry.autoCapitalize)) { input.autoCapitalize = entry.autoCapitalize as AutoCapitalize }
  return Object.keys(input).length ? input : undefined
}

/** The `fieldInputs` entry written on a node (fieldConfig.ts), or an empty one. */
export const inputOf = (node: JSONSchema4): FieldInput => {
  const raw: unknown = node[INPUT_KEY]
  return isRecord(raw) ? raw : {}
}

/** The typing props a text Input and a TextArea share: only the ones set (see `textInputProps`). */
export const typingProps = (node: JSONSchema4): Omit<FieldInput, 'placeholder' | 'type'> => {
  const { autoCapitalize, autoComplete, spellCheck } = inputOf(node)
  return {
    ...(autoCapitalize ? { autoCapitalize } : {}),
    ...(autoComplete ? { autoComplete } : {}),
    ...(spellCheck !== undefined ? { spellCheck } : {}),
  }
}

/** The props a text Input takes from its node: only the ones set, so an Input without them is as before. */
export const textInputProps = (node: JSONSchema4): FieldInput => {
  const { placeholder, type } = inputOf(node)
  return {
    ...typingProps(node),
    ...(placeholder ? { placeholder } : {}),
    ...(type ? { type } : {}),
  }
}

/** Whether any `fieldInputs` entry gives a field an input type (the form then sets `novalidate`). */
export const anyInputType = (fieldInputs: unknown): boolean =>
  Array.isArray(fieldInputs) && fieldInputs.some((entry) => isRecord(entry) && fieldInputOf(entry)?.type !== undefined)
