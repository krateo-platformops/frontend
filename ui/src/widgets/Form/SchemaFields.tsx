import { Form as AntdForm, AutoComplete, Collapse, Input, InputNumber, Select, Switch } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import type { JSONSchema4 } from 'json-schema'
import { useState } from 'react'

import styles from './Form.module.css'
import type { SuggestionGroup } from './utils'
import { getOptionsFromEnum, getSuggestionGroups, suggestionSearchText } from './utils'

/**
 * Editor for a free-form object/array node (a `type: object` map without `properties`,
 * e.g. `x-kubernetes-preserve-unknown-fields` like a `tags`/`labels` map, or a non-string
 * array). antd injects `value`/`onChange`: the value stays a real object/array — edited as
 * JSON — so it is submitted correctly and never rendered as the string "[object Object]".
 */
const JsonValueInput = ({ onChange, value }: { onChange?: (next: unknown) => void; value?: unknown }): React.ReactNode => {
  const [text, setText] = useState<string>(() => (value === undefined || value === null ? '' : JSON.stringify(value, null, 2)))
  const [invalid, setInvalid] = useState(false)

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value
    setText(next)
    if (next.trim() === '') {
      setInvalid(false)
      onChange?.(undefined)
      return
    }
    try {
      const parsed: unknown = JSON.parse(next)
      setInvalid(false)
      onChange?.(parsed)
    } catch {
      setInvalid(true)
    }
  }

  return (
    <Input.TextArea
      autoSize={{ maxRows: 12, minRows: 2 }}
      onChange={handleChange}
      placeholder='{ } — JSON (key/value map)'
      status={invalid ? 'error' : undefined}
      style={{ fontFamily: 'var(--font-mono, monospace)' }}
      value={text}
    />
  )
}

/**
 * Turns normalised suggestion groups into antd options.
 *
 * Two things the plain `{ label, value }` pair cannot carry, both of which the catalogue needs:
 *
 * - The SECOND LINE. A suggestion is only useful if the reader can tell what it is without
 *   already knowing — a metric name alone ("k8s.pod.memory.working_set") says less than the
 *   same name over its unit. So `label` is a ReactNode, name over muted description.
 * - The SEARCH TEXT. Because `label` is a node, antd's `optionFilterProp` has nothing to match
 *   on, and matching `value` alone would make the description unsearchable. `title` carries the
 *   flattened label+value+description that `filterSuggestion` matches — and, being the native
 *   `title` attribute, it doubles as the hover tooltip for an entry the row has to truncate.
 *
 * A single ungrouped bucket stays flat (no optgroup heading for a list that has only one).
 */
const suggestionOptions = (groups: SuggestionGroup[]): DefaultOptionType[] => {
  const optionFor = (entry: SuggestionGroup['entries'][number]): DefaultOptionType => ({
    label: (
      <span className={styles.optionLabel}>
        <span className={styles.optionMain}>{entry.label ?? entry.value}</span>
        {entry.description ? <span className={styles.optionDesc}>{entry.description}</span> : null}
      </span>
    ),
    title: suggestionSearchText(entry),
    value: entry.value,
  })

  if (groups.length === 1 && !groups[0].group) {
    return groups[0].entries.map(optionFor)
  }

  return groups.map((bucket) => ({
    label: bucket.group ?? 'Other',
    options: bucket.entries.map(optionFor),
  }))
}

/** Substring match over a suggestion's flattened search text (see `suggestionOptions`). */
const filterSuggestion = (input: string, option?: DefaultOptionType): boolean =>
  typeof option?.title === 'string' && option.title.includes(input.trim().toLowerCase())

/** Renders an antd form control for a single schema node (the schema-driven control). */
const controlFor = (node: JSONSchema4): React.ReactNode => {
  // SUGGESTIONS BEFORE EVERYTHING ELSE, and deliberately so: they are an OPEN catalogue, so the
  // control they produce must still accept a value that is not in the list. A node may carry
  // both `enum` and suggestions only by authoring mistake — `enum` would then silently win and
  // reject every hand-typed value, which is the exact failure suggestions exist to avoid.
  const suggestions = getSuggestionGroups(node)
  if (suggestions) {
    const options = suggestionOptions(suggestions)
    // An open string ARRAY keeps its `mode='tags'` multi-select — now seeded with the catalogue.
    // Tags mode already admits values that are not options, so free entry survives.
    if (node.type === 'array') {
      return (
        <Select
          allowClear
          filterOption={filterSuggestion}
          mode='tags'
          options={options}
          placeholder='Select or type…'
          style={{ width: '100%' }}
        />
      )
    }
    // A scalar becomes an AutoComplete, NOT a Select: antd's Select commits one of its options,
    // whereas AutoComplete is a text input that happens to suggest — so the field still submits
    // whatever the user typed.
    return (
      <AutoComplete
        allowClear
        filterOption={filterSuggestion}
        options={options}
        placeholder='Select or type…'
        style={{ width: '100%' }}
      />
    )
  }

  if (Array.isArray(node.enum)) {
    // `showSearch` because an enum is not always short — a server-side filter can hand this
    // widget a list with hundreds of entries (the platform collects 174 distinct metric names),
    // and a scroll-only dropdown is unusable at that size. It stays CLOSED: search filters the
    // options, it does not admit a value outside them.
    return (
      <Select
        allowClear
        optionFilterProp='label'
        options={getOptionsFromEnum(node.enum)}
        placeholder='Select…'
        showSearch
        style={{ width: '100%' }}
      />
    )
  }
  if (node.type === 'boolean') { return <Switch /> }
  if (node.type === 'integer' || node.type === 'number') { return <InputNumber style={{ width: '100%' }} /> }
  // Array with a FIXED items.enum → a closed multi-select (pick N of the known options —
  // e.g. the W3-1 fleet-rollout target-clusters field); checked before the free-text
  // `tags` fallback, which is for open string arrays only.
  if (node.type === 'array' && !Array.isArray(node.items) && Array.isArray(node.items?.enum)) {
    return <Select allowClear mode='multiple' optionFilterProp='label' options={getOptionsFromEnum(node.items.enum)} placeholder='Select…' style={{ width: '100%' }} />
  }
  if (node.type === 'array' && !Array.isArray(node.items) && node.items?.type === 'string') {
    return <Select allowClear mode='tags' placeholder='Add values…' style={{ width: '100%' }} />
  }
  if (node.type === 'object' || node.type === 'array') { return <JsonValueInput /> }
  return <Input />
}

const isGroup = (node: JSONSchema4): boolean => node.type === 'object' && !!node.properties

/**
 * One COHERENT header for every property — the property's human `title` (the label the blueprint
 * author wrote in values.schema.json) falling back to the schema `key`, plus its `description`
 * (muted, if present). Used identically for scalars, toggles, maps and nested-object groups so the
 * whole form reads as one system. Preferring `title` means a novice sees "Availability zones", not
 * the raw key `azs`.
 */
const fieldHeader = (key: string, node: JSONSchema4, isRequired: boolean): React.ReactNode => {
  const description = typeof node.description === 'string' ? node.description : ''
  const label = typeof node.title === 'string' && node.title.trim() ? node.title : key
  return (
    <span className={styles.fieldLabel}>
      <span className={styles.fieldName}>
        {label}
        {isRequired ? <span className={styles.req}> *</span> : null}
      </span>
      {description ? <span className={styles.fieldDesc}>{description}</span> : null}
    </span>
  )
}

interface SchemaFieldsProps {
  /** the (sub)schema whose `properties` become form fields */
  schema: JSONSchema4
  /** top-level property names to omit (e.g. legacy CustomForm `propertiesToHide`) */
  hide?: string[]
  /** parent path — antd `Form.Item` name for nested objects (e.g. ['spec', 'size']) */
  namePath?: string[]
}

/**
 * Renders ONE property — a nested-object group (the same header above its indented child
 * fields) or a leaf `Form.Item`. The `Form.Item` `name` / `required` rule / `valuePropName`
 * are preserved verbatim regardless of which partition (required up-front or Advanced
 * collapse) the property lands in, so submission + validation are identical to a flat render.
 */
function renderEntry(key: string, node: JSONSchema4, hide: string[], namePath: string[], isRequired: boolean): React.ReactNode {
  const path = [...namePath, key]

  if (isGroup(node)) {
    return (
      <div className={styles.group} key={path.join('.')}>
        {fieldHeader(key, node, false)}
        <div className={styles.groupBody}>
          {/* recursion — SchemaFields partitions this nested group's own required/optional split */}
          {/* eslint-disable-next-line @typescript-eslint/no-use-before-define */}
          <SchemaFields hide={hide} namePath={path} schema={node} />
        </div>
      </div>
    )
  }

  return (
    // The label is a stacked name + (wrapping) description meant to sit ABOVE the control. Force
    // full-width label/wrapper columns so that stays true even under a Form `layout='horizontal'`
    // (otherwise antd puts the label beside the control and a long description crowds/overlaps it).
    // A no-op for vertical/inline layouts (already stacked). #54 §0.4 / #57 #5.
    <AntdForm.Item
      className={styles.field}
      colon={false}
      hasFeedback={isRequired && node.type !== 'boolean'}
      key={path.join('.')}
      label={fieldHeader(key, node, isRequired)}
      labelCol={{ span: 24 }}
      name={path}
      rules={isRequired ? [{ message: `${key} is required`, required: true }] : undefined}
      valuePropName={node.type === 'boolean' ? 'checked' : undefined}
      wrapperCol={{ span: 24 }}
    >
      {controlFor(node)}
    </AntdForm.Item>
  )
}

/**
 * Schema-driven fields, rendered in EXACT `values.schema.json` order (each property in
 * sequence — never reordered). Every property uses one coherent shape: the `name`+
 * `description` header (see `fieldHeader`) above its control. The control is the only thing
 * that varies by type — Input / Switch / Select / InputNumber / JSON editor — and a nested
 * object is the same header above its child fields, indented. The `Form.Item` `name` (and
 * `required`/`valuePropName`) is preserved verbatim, so submission is unchanged.
 *
 * Progressive disclosure (FRM1): the properties are PARTITIONED by `schema.required` —
 * REQUIRED ones stay up-front (as before), the NON-required ones are collected into an antd
 * `Collapse` titled "Advanced · N settings", collapsed by default. This is disclosure, NOT
 * hiding: an optional field inside the collapse is still mounted, so it validates and submits
 * its value exactly as a flat field would. `hide` still omits a property from EITHER partition,
 * order within each partition follows the existing (stringSchema-driven) property order, and a
 * form with no optional fields renders no Advanced section at all.
 */
export const SchemaFields = ({ hide = [], namePath = [], schema }: SchemaFieldsProps): React.ReactNode => {
  if (!schema?.properties) { return null }
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])

  const visible = Object.entries(schema.properties).filter(([key]) => !hide.includes(key))
  const requiredEntries = visible.filter(([key]) => required.has(key))
  const optionalEntries = visible.filter(([key]) => !required.has(key))

  return (
    <>
      {requiredEntries.map(([key, node]) => renderEntry(key, node, hide, namePath, true))}
      {optionalEntries.length > 0 ? (
        <Collapse
          className={styles.advanced}
          items={[{
            children: <>{optionalEntries.map(([key, node]) => renderEntry(key, node, hide, namePath, false))}</>,
            // Always mount the optional fields (they're just visually hidden while collapsed) so
            // they register with the form store and submit / validate identically to an up-front
            // field — the disclosure never drops a value, even if the collapse is never opened.
            forceRender: true,
            key: 'advanced',
            label: `Advanced · ${optionalEntries.length} setting${optionalEntries.length === 1 ? '' : 's'}`,
          }]}
        />
      ) : null}
    </>
  )
}

interface Section { id: string; label: string }

/**
 * Section-navigated schema form for COMPLEX blueprints (e.g. the installer's ~680 fields):
 * a left rail of sections — "Top-level values" (the root's ungrouped, non-object properties)
 * plus one per top-level object group — and a body showing only the active section. Every
 * section stays mounted (hidden, not unmounted) so all values + validation persist for
 * submission; only the active one is shown. Falls back to a flat render when there's <2
 * sections. The "Top-level values" entry is the ONE synthetic label (no matching schema key)
 * — it is styled distinctly in the rail so it reads as a category, not a real property.
 */
export const SchemaForm = ({ hide = [], schema }: { schema: JSONSchema4; hide?: string[] }): React.ReactNode => {
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema4>
  const groupKeys = Object.keys(properties).filter((key) => !hide.includes(key) && isGroup(properties[key]))
  const hasLoose = Object.keys(properties).some((key) => !hide.includes(key) && !isGroup(properties[key]))

  const sections: Section[] = []
  if (hasLoose) { sections.push({ id: '__general__', label: 'Top-level values' }) }
  groupKeys.forEach((key) => {
    const groupTitle = properties[key].title
    sections.push({ id: key, label: typeof groupTitle === 'string' && groupTitle.trim() ? groupTitle : key })
  })

  const [active, setActive] = useState<string>(sections[0]?.id ?? '__general__')

  if (sections.length < 2) {
    return <SchemaFields hide={hide} schema={schema} />
  }

  return (
    <div className={styles.sectioned}>
      <nav className={styles.secNav}>
        {sections.map((section) => (
          <button
            className={[
              styles.secItem,
              active === section.id ? styles.secActive : '',
              section.id === '__general__' ? styles.secSynthetic : '',
            ].filter(Boolean).join(' ')}
            key={section.id}
            onClick={() => { setActive(section.id) }}
            type='button'
          >
            {section.label}
          </button>
        ))}
      </nav>
      <div className={styles.secBody}>
        {sections.map((section) => (
          <div key={section.id} style={active === section.id ? undefined : { display: 'none' }}>
            {section.id === '__general__'
              ? <SchemaFields hide={[...hide, ...groupKeys]} schema={schema} />
              : <SchemaFields hide={hide} namePath={[section.id]} schema={properties[section.id]} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SchemaFields
