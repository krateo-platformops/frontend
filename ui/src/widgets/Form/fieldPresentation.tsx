import { Form as AntdForm, ConfigProvider } from 'antd'
import type { FormItemProps, FormProps } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { createContext, useContext, useMemo } from 'react'

import type { FieldPath } from './fieldDependencies'
import { HELP_KEY } from './fieldKeys'
import styles from './Form.module.css'
import { fieldLabel, hasValue } from './schemaRules'

/**
 * How a schema form marks and reports its fields, from `widgetData`. Every member is an opt-in:
 * absent, the form renders exactly as before the option existed (Form.unchanged.test.tsx).
 *
 * - `requiredMark: optional` — antd Form's `requiredMark="optional"`: a required field carries no
 *   mark and every other field reads "(optional)". The optional fields render in place, in schema
 *   order, rather than in the "Advanced" collapse: the mark is what sets them apart, so a form uses
 *   one or the other.
 * - `requiredMark: hidden` — antd Form's `requiredMark={false}`: no field carries a mark, required
 *   or not. The fields keep the default layout (optional ones in "Advanced").
 * - `hasFeedback: rules` — the feedback icons antd's `hasFeedback` draws, on every field with a
 *   validation rule, where by default only required fields have them. An optional field that is
 *   still empty shows no success icon: nothing was checked.
 */
export interface FieldPresentation {
  requiredMark?: 'optional' | 'hidden'
  hasFeedback?: 'rules'
}

export const FieldPresentationContext = createContext<FieldPresentation>({})

/** antd's `requiredMark` render for a schema form: the label as it is (see `antdRequiredMark`). */
const identityMark = (label: React.ReactNode): React.ReactNode => label

/**
 * The antd Form `requiredMark` for the form's `requiredMark` option. Absent: antd's default.
 * `hidden`: `false`, no marks at all. `optional` on a SCHEMA form: a render returning the label as
 * it is — the field header already carries "(optional)" beside the name (`requiredMarkFor`), where
 * antd's own would follow the whole label, under the description; being a render, it still tells
 * antd the form marks optional fields, so no required asterisk is drawn. `optional` on a composable
 * Form: antd's own, since its children are plain Form.Items.
 */
export const antdRequiredMark = (mark: FieldPresentation['requiredMark'], schemaForm: boolean): FormProps['requiredMark'] => {
  if (mark === 'hidden') { return false }
  if (mark === 'optional') { return schemaForm ? identityMark : 'optional' }
  return undefined
}

/**
 * How a field's header marks it: the form's `requiredMark` and the "(optional)" text in the
 * locale antd's own mark uses.
 */
export interface Marks {
  hidden: boolean
  optional: boolean
  optionalText: string
}

export const useMarks = (): Marks => {
  const { requiredMark } = useContext(FieldPresentationContext)
  const { locale } = useContext(ConfigProvider.ConfigContext)
  return { hidden: requiredMark === 'hidden', optional: requiredMark === 'optional', optionalText: locale?.Form?.optional ?? '(optional)' }
}

/**
 * The mark after a field's name. By default a required field gets ` *` and an optional one
 * nothing; under `requiredMark: optional` it is the other way round, in antd's "(optional)". The
 * schema form draws its marks itself, beside the name and above the description, where antd would
 * append its own after the whole label (see `identityMark` in Form.tsx). A group's header passes
 * no `marks`, and has none.
 */
export const requiredMarkFor = (isRequired: boolean, marks: Marks | undefined): React.ReactNode => {
  if (!marks || marks.hidden) { return null }
  if (marks.optional) {
    return isRequired ? null : <span className={styles.optionalMark}>{marks.optionalText}</span>
  }
  return isRequired ? <span className={styles.req}> *</span> : null
}

/**
 * One COHERENT header for every property — the property's human `title` (the label the blueprint
 * author wrote in values.schema.json) falling back to the schema `key`, plus its `description`
 * (muted, if present). Used identically for scalars, toggles, maps and nested-object groups so the
 * whole form reads as one system. Preferring `title` means a novice sees "Availability zones", not
 * the raw key `azs`.
 */
export const fieldHeader = (key: string, node: JSONSchema4, isRequired: boolean, marks?: Marks): React.ReactNode => {
  const description = typeof node.description === 'string' ? node.description : ''
  const label = fieldLabel(key, node)
  return (
    <span className={styles.fieldLabel}>
      <span className={styles.fieldName}>
        {label}
        {requiredMarkFor(isRequired, marks)}
      </span>
      {description ? <span className={styles.fieldDesc}>{description}</span> : null}
    </span>
  )
}

/**
 * A field's `fieldHelp` (written on its node by fieldConfig.ts) as the Form.Item `extra` under its
 * input, or undefined when the CR gives none — and then the Form.Item has no `extra` at all.
 */
export const fieldHelpOf = (node: JSONSchema4): React.ReactNode => {
  const help: unknown = node[HELP_KEY]
  return typeof help === 'string' && help ? <span className={styles.fieldHelp}>{help}</span> : undefined
}

/**
 * An optional field's Form.Item under `hasFeedback: rules`. Its rules pass on an empty value, and
 * antd would then show the success icon in an empty box, so the icon waits for a value. The
 * feedback itself stays on, so the control keeps one structure as the value comes and goes (an
 * Input that gains or loses its suffix is remounted, and loses focus).
 */
export const OptionalFeedbackItem = ({ watchPath, ...props }: FormItemProps & { watchPath: FieldPath }): React.ReactNode => {
  const form = AntdForm.useFormInstance()
  const filled = hasValue(AntdForm.useWatch(watchPath, form))
  const hasFeedback = useMemo(() => ({ icons: () => (filled ? {} : { success: false as const }) }), [filled])
  return <AntdForm.Item {...props} hasFeedback={hasFeedback} />
}
