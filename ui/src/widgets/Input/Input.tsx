import { Form, Input as AntdInput } from 'antd'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'

import type { WidgetProps } from '../../types/Widget'
import { useRegisterSecretField } from '../Form/secretFieldsRegistry'

import type { Input as WidgetType } from './Input.type'

export type InputWidgetData = WidgetType['spec']['widgetData']

/**
 * Faithful wrapper of antd `Input`. Two modes:
 *  • default — a `Form.Item` control bound by `name`, for use inside a `Form`.
 *  • `queryParam` set — a STANDALONE, URL-query-bound SEARCH box (antd `Input.Search`,
 *    no Form context). Submitting (Enter or the search button) writes `?<queryParam>=`
 *    into the URL — the same URL→extras channel Select/RangePicker use — so a data source
 *    can filter SERVER-SIDE in its RESTAction jq (e.g. reading `.q`). Clearing the box (the
 *    allowClear ✕ or deleting the text) removes the param. The `key` ties the uncontrolled
 *    box to the committed value so deep links / back-forward reflect in the field.
 */
const Input = ({ uid, widgetData }: WidgetProps<InputWidgetData>) => {
  const { allowClear, defaultValue, disabled, label, maxLength, name, placeholder, queryParam, required, size, type } = widgetData
  const [searchParams, setSearchParams] = useSearchParams()
  // A password field is a SECRET of the enclosing composable Form: registered so the Form keeps it
  // out of drafts, the review, /jq and the audit (see Form/secretFieldsRegistry.ts), and never
  // prefilled — neither from `defaultValue` nor from the Form's initialValues.
  const isSecret = type === 'password' && !queryParam
  useRegisterSecretField(isSecret && name ? [name] : undefined)
  const form = Form.useFormInstance() as ReturnType<typeof Form.useFormInstance> | undefined
  useEffect(() => {
    if (isSecret && name && form && !form.isFieldTouched(name)) {
      form.setFieldValue(name, undefined)
    }
  }, [form, isSecret, name])

  if (queryParam) {
    const committed = searchParams.get(queryParam) ?? ''
    const commit = (next: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        const trimmed = next.trim()
        if (trimmed) {
          params.set(queryParam, trimmed)
        } else {
          params.delete(queryParam)
        }
        return params
      }, { replace: false })
    }

    return (
      <AntdInput.Search
        allowClear={allowClear}
        defaultValue={committed}
        disabled={disabled}
        key={`${uid}-${committed}`}
        maxLength={maxLength}
        // Clearing (✕ or deleting all text) resets the filter immediately; typing does NOT
        // refetch — only submit (Enter / the search button → onSearch) commits a query.
        onChange={(event) => { if (!event.target.value) { commit('') } }}
        onSearch={commit}
        placeholder={placeholder}
        size={size}
        // A query-bound search box is a list FILTER, not a form field — cap its width so it
        // doesn't grow full-width and force its toolbar Flex to wrap onto a second row
        // (issues #79 / #75). Mirrors the old PageSearch max-width:360 cap; the parent Flex's
        // `justify` positions it (e.g. space-between → chips left, search right).
        style={{ maxWidth: 380 }}
      />
    )
  }

  return (
    <Form.Item
      initialValue={isSecret ? undefined : defaultValue}
      key={uid}
      label={label}
      name={name}
      rules={required ? [{ message: `${label ?? name} is required`, required: true }] : undefined}
    >
      <AntdInput
        allowClear={allowClear}
        autoComplete={isSecret ? 'new-password' : undefined}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        size={size}
        type={type}
      />
    </Form.Item>
  )
}

export default Input
