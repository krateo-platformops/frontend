import { Form as AntdForm, Checkbox } from 'antd'
import type { Rule } from 'antd/es/form'
import type { JSONSchema4 } from 'json-schema'

import type { FieldPath } from './fieldDependencies'
import { CHECKBOX_KEY } from './fieldKeys'
import { fieldHelpOf, type Marks, requiredMarkFor } from './fieldPresentation'
import styles from './Form.module.css'
import { fieldLabel, hasValue } from './schemaRules'

/**
 * A boolean field drawn as a Checkbox whose text is the field's label — a `checkboxes` entry of
 * widgetData, written on the field's node by fieldConfig.ts:
 *
 * ```yaml
 * checkboxes:
 *   - name: consent
 *     link: { text: privacy policy, href: https://example.com/privacy }
 *     requiredMessage: Please agree to the processing of your details.
 * ```
 *
 * The label is plain text, never markup. One phrase of it can be a link: the first occurrence of
 * `link.text` becomes an anchor to `link.href` (or the link follows the label, when the phrase is
 * not in it). Only an http(s), mailto or same-origin path href is drawn as a link; any other is
 * dropped and its phrase stays text.
 */
export interface CheckboxSpec {
  link?: { text: string; href: string }
  /** shown when a REQUIRED checkbox is left unticked */
  requiredMessage?: string
}

export const getCheckboxSpec = (node: JSONSchema4): CheckboxSpec | undefined => {
  const raw: unknown = node[CHECKBOX_KEY]
  if (node.type !== 'boolean' || !raw || typeof raw !== 'object' || Array.isArray(raw)) { return undefined }
  return raw
}

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Whitespace or a control character. The URL parser silently drops some (tab, newline), so the
 * href it navigates to is not the one that was checked. */
const UNSAFE_CHAR = /[\s\p{Cc}]/u

/**
 * The href a label may link to, as the browser will navigate to it; undefined for anything else
 * (`javascript:`, `data:`, an off-site `//host`, …). A path is resolved against the portal and kept
 * only if it stays on it.
 */
export const safeHref = (href: string): string | undefined => {
  const trimmed = href.trim()
  if (!trimmed || UNSAFE_CHAR.test(trimmed)) { return undefined }
  try {
    if (trimmed.startsWith('/')) {
      const url = new URL(trimmed, window.location.origin)
      return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : undefined
    }
    const url = new URL(trimmed)
    return LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

/** The checkbox's text: the label, with the spec's link phrase as an anchor. */
export const CheckboxText = ({ label, link }: { label: string; link?: CheckboxSpec['link'] }): React.ReactNode => {
  const href = link ? safeHref(link.href) : undefined
  if (!link || !href) { return label }
  const anchor = (
    <a
      href={href}
      // the form stays where it is: a consent text's link is read beside the form, not instead of it
      rel='noopener noreferrer'
      target='_blank'
    >
      {link.text}
    </a>
  )
  const at = label.indexOf(link.text)
  if (at < 0) { return <>{label} {anchor}</> }
  return <>{label.slice(0, at)}{anchor}{label.slice(at + link.text.length)}</>
}

const DEFAULT_REQUIRED_MESSAGE = 'Tick this box to continue.'

/**
 * A required checkbox must be TICKED. `required: true` alone accepts `false` (it is a value), which
 * is right for a Switch and wrong for a box someone has to agree to. In an optional object (`group`)
 * it is owed only once the object holds something, as every required field there.
 */
export const mustBeTicked = (spec: CheckboxSpec, group: Array<string | number> | undefined): Rule => ({ getFieldValue }) => ({
  validator: (_rule, value: unknown) => (value === true || (group && !hasValue(getFieldValue(group)))
    ? Promise.resolve()
    : Promise.reject(new Error(spec.requiredMessage ?? DEFAULT_REQUIRED_MESSAGE))),
})

/**
 * A boolean with a `checkboxes` entry: an antd Checkbox whose text is the field's label (with its
 * one link), and, when required, it must be ticked. The label is the checkbox's own, so the
 * Form.Item has none; the description goes under the box.
 */
export const checkboxItem = (key: string, node: JSONSchema4, path: Array<string | number>, isRequired: boolean, group: FieldPath | undefined, marks: Marks): React.ReactNode => {
  const spec = getCheckboxSpec(node) ?? {}
  const description = typeof node.description === 'string' ? node.description : ''
  const help = fieldHelpOf(node)
  let extra: React.ReactNode = description ? <span className={styles.fieldDesc}>{description}</span> : undefined
  // `fieldHelp` follows the description, both under the box.
  if (help) { extra = extra ? <>{extra} {help}</> : help }
  return (
    <AntdForm.Item
      className={styles.field}
      colon={false}
      extra={extra}
      key={path.join('.')}
      labelCol={{ span: 24 }}
      name={path}
      rules={isRequired ? [mustBeTicked(spec, group)] : undefined}
      valuePropName='checked'
      wrapperCol={{ span: 24 }}
    >
      <Checkbox className={styles.checkbox}>
        <CheckboxText label={fieldLabel(key, node)} link={spec.link} />
        {requiredMarkFor(isRequired, marks)}
      </Checkbox>
    </AntdForm.Item>
  )
}
