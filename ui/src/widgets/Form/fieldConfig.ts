import type { JSONSchema4 } from 'json-schema'

import { ROW } from './fieldDependencies'
import { fieldInputOf, takesFieldInput } from './fieldInputs'
import { CHECK_KEY, CHECKBOX_KEY, HELP_KEY, INPUT_KEY, INTERNAL_KEYS, OPTIONS_KEY, REQUIRED_MESSAGE_KEY, ROW_TITLE_KEY, SUGGESTIONS_KEY, TEXTAREA_KEY, VISIBLE_WHEN_KEY } from './fieldKeys'

/**
 * The field configuration of a schema form, as `widgetData` carries it — the format of the
 * previous frontend, typed in Form.schema.json so the CRD and snowplow validate it:
 *
 * ```yaml
 * autocomplete:            # options from a RESTAction; typed text is kept unless closed
 *   - { name: region, resourceRefId: regions, closed: true }
 *   - { name: owner, resourceRefId: users, extra: { key: q }, minChars: 2 }
 * checkboxes:              # a boolean drawn as a Checkbox labelled by its title (checkboxField.tsx)
 *   - { name: consent, link: { text: privacy policy, href: https://example.com/privacy }, requiredMessage: Please agree. }
 * dependencies:            # options that depend on another field's value; a closed list unless closed: false
 *   - { name: zone, dependsOn: { name: region }, resourceRefId: zones, extra: { key: region } }
 * displayingDependencies:  # shown only while the condition holds
 *   - { name: service.nodePort, dependsOn: { name: service.type, conditionType: value, value: { type: string, stringValue: NodePort } } }
 * objectFields:            # a list of objects, its rows titled by one of their fields
 *   - { path: hosts, displayField: host }
 * suggestions:             # a static, open catalogue
 *   - { name: logLevel, options: [{ value: info }, { value: warn, label: Warning }] }
 * fieldHelp:               # help text under the input (antd Form.Item `extra`)
 *   - { name: phone, text: Start with + and your country code. }
 * fieldChecks:             # a check against an allow-listed endpoint while typing (fieldCheck.tsx)
 *   - { name: username, path: /intake/checks, answers: [...], otherwise: {...} }
 * fieldInputs:             # a field's placeholder, input type and autocomplete token (fieldInputs.ts)
 *   - { name: email, type: email, autoComplete: email, placeholder: jane@example.com }
 * textareas:               # a string drawn as a multi-line TextArea
 *   - { name: description, rows: 4 }
 * validationMessages:      # the message a required field shows when left empty
 *   - { name: email, requiredMessage: Enter your email address. }
 * ```
 *
 * `name`, `path` and `dependsOn.name` are dotted paths from the root of the form. A path goes
 * through a list without an index: `hosts.zone` is the `zone` of every `hosts` row, and a
 * `dependsOn.name` inside the same list (`hosts.region`) reads the same row.
 *
 * `applyFieldConfig` writes each entry on the schema node it names (fieldKeys.ts), where the
 * form's controls read it. An entry naming no field, or malformed, is skipped: a mistake in the
 * configuration never blanks the form.
 */

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** The schema template path a dotted `name` names (lists crossed as ROW), or undefined. */
export const templatePathOf = (schema: JSONSchema4, name: string): string[] | undefined => {
  const keys = name.split('.').map((key) => key.trim())
  if (!keys.length || keys.some((key) => !key)) { return undefined }
  const path: string[] = []
  let node: JSONSchema4 | undefined = schema
  for (const key of keys) {
    while (node && !node.properties?.[key] && node.items && !Array.isArray(node.items)) {
      node = node.items
      path.push(ROW)
    }
    node = node?.properties?.[key]
    if (!node) { return undefined }
    path.push(key)
  }
  return path
}

const nodeAtTemplate = (schema: JSONSchema4, path: string[]): JSONSchema4 | undefined =>
  path.reduce<JSONSchema4 | undefined>((node, key) => {
    if (!node) { return undefined }
    if (key === ROW) { return Array.isArray(node.items) ? undefined : node.items }
    return node.properties?.[key]
  }, schema)

/**
 * The field reference the form resolves (see `resolveFieldPath`): the template path from the
 * root, so a reference into the list the field lives in reads the field's own row.
 */
const reference = (schema: JSONSchema4, name: unknown): string | undefined => {
  const dotted = text(name)
  const path = dotted ? templatePathOf(schema, dotted) : undefined
  return path ? `/${path.join('.')}` : undefined
}

/** A deep copy without the internal keys an incoming schema must not carry. */
const cleanCopy = (value: unknown): unknown => {
  if (Array.isArray(value)) { return value.map(cleanCopy) }
  if (!isRecord(value)) { return value }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !INTERNAL_KEYS.includes(key))
    .map(([key, child]) => [key, cleanCopy(child)]))
}

const entries = (list: unknown): Raw[] => (Array.isArray(list) ? list.filter(isRecord) : [])

/** An object with fields or a list: drawn as a group, not as one input. */
const isGroupish = (node: JSONSchema4): boolean => node.type === 'object' || node.type === 'array'

const optionsOf = (schema: JSONSchema4, entry: Raw, closedByDefault: boolean, withDependsOn: boolean): Raw | undefined => {
  const ref = text(entry.resourceRefId)
  if (!ref) { return undefined }
  const key = isRecord(entry.extra) ? entry.extra.key : undefined
  const options: Raw = { closed: typeof entry.closed === 'boolean' ? entry.closed : closedByDefault, ref }
  if (entry.fallback !== undefined) { options.fallback = entry.fallback }
  if (withDependsOn) {
    const field = isRecord(entry.dependsOn) ? reference(schema, entry.dependsOn.name) : undefined
    // A dependency naming no field still reaches the field, which then says why it cannot load.
    options.dependsOn = { field: field ?? '', param: key }
  } else if (key !== undefined) {
    options.search = { minChars: entry.minChars, param: key }
  }
  return options
}

/** The value a `conditionType: value` condition expects, as the previous frontend typed it. */
const expectedValue = (value: unknown): { value: unknown } | undefined => {
  if (!isRecord(value)) { return undefined }
  switch (value.type) {
    case 'string': return { value: value.stringValue }
    case 'integer': return { value: value.integerValue }
    case 'boolean': return { value: value.booleanValue }
    case 'array': return { value: value.arrayValue }
    case 'option': return isRecord(value.optionValue) ? { value: value.optionValue.value } : undefined
    case 'null': return { value: null }
    default: return undefined
  }
}

const conditionOf = (schema: JSONSchema4, entry: Raw): Raw | undefined => {
  if (!isRecord(entry.dependsOn)) { return undefined }
  const field = reference(schema, entry.dependsOn.name)
  if (!field) { return undefined }
  if (entry.dependsOn.conditionType === 'notEmpty') { return { field, notEmpty: true } }
  if (entry.dependsOn.conditionType === 'value') {
    const expected = expectedValue(entry.dependsOn.value)
    return expected ? { equals: expected.value, field } : undefined
  }
  return undefined
}

/**
 * `schema` with the `widgetData` field configuration written on the nodes it names. The input is
 * not changed.
 */
export const applyFieldConfig = (schema: JSONSchema4 | undefined, config: Raw): JSONSchema4 | undefined => {
  if (!schema) { return schema }
  const root = cleanCopy(schema) as JSONSchema4
  const at = (name: unknown): JSONSchema4 | undefined => {
    const dotted = text(name)
    const path = dotted ? templatePathOf(root, dotted) : undefined
    return path ? nodeAtTemplate(root, path) : undefined
  }

  for (const entry of entries(config.autocomplete)) {
    const node = at(entry.name)
    const options = node && optionsOf(root, entry, false, false)
    if (node && options) { node[OPTIONS_KEY] = options }
  }
  // After autocomplete: a field in both lists depends on another, as the previous frontend had it.
  for (const entry of entries(config.dependencies)) {
    const node = at(entry.name)
    const options = node && optionsOf(root, entry, true, true)
    if (node && options) { node[OPTIONS_KEY] = options }
  }

  const conditions = new Map<JSONSchema4, Raw[]>()
  for (const entry of entries(config.displayingDependencies)) {
    const node = at(entry.name)
    const condition = node && conditionOf(root, entry)
    if (node && condition) { conditions.set(node, [...(conditions.get(node) ?? []), condition]) }
  }
  for (const [node, all] of conditions) {
    node[VISIBLE_WHEN_KEY] = all.length === 1 ? all[0] : { all }
  }

  for (const entry of entries(config.objectFields)) {
    const node = at(entry.path)
    const displayField = text(entry.displayField)
    if (node && displayField) { node[ROW_TITLE_KEY] = displayField }
  }

  // A checkbox is a way to draw a boolean: an entry naming any other field is skipped.
  for (const entry of entries(config.checkboxes)) {
    const node = at(entry.name)
    if (node?.type !== 'boolean') { continue }
    const spec: Raw = {}
    const link = isRecord(entry.link) ? { href: text(entry.link.href), text: text(entry.link.text) } : undefined
    if (link?.href && link.text) { spec.link = link }
    const requiredMessage = text(entry.requiredMessage)
    if (requiredMessage) { spec.requiredMessage = requiredMessage }
    node[CHECKBOX_KEY] = spec
  }

  for (const entry of entries(config.suggestions)) {
    const node = at(entry.name)
    if (node && Array.isArray(entry.options)) { node[SUGGESTIONS_KEY] = entry.options }
  }

  // Help under a field's input: a leaf's, so an entry naming a group or a list is skipped.
  for (const entry of entries(config.fieldHelp)) {
    const node = at(entry.name)
    const help = text(entry.text)
    if (node && help && !isGroupish(node)) { node[HELP_KEY] = help }
  }

  // A check runs on a typed leaf: a group, a list or a boolean has no text to check.
  for (const entry of entries(config.fieldChecks)) {
    const dotted = text(entry.name)
    const node = at(entry.name)
    const path = text(entry.path)
    if (!dotted || !node || !path || isGroupish(node) || node.type === 'boolean') { continue }
    const spec: Raw = {
      answers: entries(entry.answers),
      bodyKey: text(entry.bodyKey) ?? dotted.split('.').pop(),
      path,
    }
    if (isRecord(entry.bodyExtras)) { spec.bodyExtras = entry.bodyExtras }
    if (typeof entry.debounceMs === 'number') { spec.debounceMs = entry.debounceMs }
    if (typeof entry.timeoutMs === 'number') { spec.timeoutMs = entry.timeoutMs }
    if (isRecord(entry.otherwise)) { spec.otherwise = entry.otherwise }
    node[CHECK_KEY] = spec
  }

  // A textarea is a way to draw free text: a string with no list of values. Any other is skipped.
  for (const entry of entries(config.textareas)) {
    const node = at(entry.name)
    if (node?.type !== 'string' || Array.isArray(node.enum) || Array.isArray(node.oneOf)) { continue }
    node[TEXTAREA_KEY] = typeof entry.rows === 'number' ? { rows: entry.rows } : {}
  }

  // A field's input: a string-valued leaf that is not a secret. Any other entry is skipped.
  for (const entry of entries(config.fieldInputs)) {
    const node = at(entry.name)
    const input = node && takesFieldInput(node) ? fieldInputOf(entry) : undefined
    if (node && input) { node[INPUT_KEY] = input }
  }

  // The message a required field shows when it is left empty, in place of "<Label> is required".
  for (const entry of entries(config.validationMessages)) {
    const node = at(entry.name)
    const requiredMessage = text(entry.requiredMessage)
    if (node && requiredMessage) { node[REQUIRED_MESSAGE_KEY] = requiredMessage }
  }

  return root
}
