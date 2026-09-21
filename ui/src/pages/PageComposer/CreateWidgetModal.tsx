/**
 * What a widget needs before it can exist — asked at the moment of the drop.
 *
 * WHY A DROP CANNOT JUST CREATE ONE. Thirty-seven of the forty-four widget kinds have REQUIRED
 * `widgetData` fields, and they are substantive rather than ceremonial: a BarChart wants `data`,
 * `xField` and `yField`; a Button wants `actions` and `clickActionId`; a Select wants `name` and
 * `options`. A widget created without them is rejected by the apiserver at apply — which surfaces
 * at PUBLISH, long after the gesture that caused it, with nothing in between connecting the two.
 * So "drop a widget" has to mean "drop a widget and say what it needs".
 *
 * IN CRD TERMS, DELIBERATELY. The fields are named as the schema names them — `xField`, not "which
 * column goes along the bottom". That is colder than the bind-data modal's three plain questions,
 * and it is the trade that makes this work on all forty-four kinds on the first day instead of on
 * a handful well and the rest not at all. A kind whose wording deserves better can be given a
 * bespoke form later; nothing here prevents it.
 *
 * THE SCHEMA IS THE FORM. `SchemaForm` already renders a `JSONSchema4` into antd fields, and a
 * CRD's `widgetData` block IS JSON Schema, so this is wiring rather than new UI — which also means
 * a field added to a CRD appears here with no code change, and the drift gate keeps the two in
 * step. The form is scoped to the REQUIRED fields: everything optional is reachable in the Files
 * tab, and asking for forty optional properties at drop time would make creating a widget worse
 * than hand-writing one.
 */
import { Alert, Form, Input, Modal, Typography } from 'antd'
import type { JSONSchema4 } from 'json-schema'
import { useEffect, useState } from 'react'

import { SchemaForm } from '../../widgets/Form/SchemaFields'

import { WIDGET_KINDS } from './widgetKinds.generated'

const DNS_1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

/** The required-fields subset of a kind's widgetData schema — what the drop actually asks for. */
export const requiredSchema = (widgetKind: string): JSONSchema4 | null => {
  const entry = WIDGET_KINDS[widgetKind]
  if (!entry) {
    return null
  }
  const schema = entry.schema as unknown as JSONSchema4
  const properties = (schema.properties ?? {}) as Record<string, JSONSchema4>
  const required = entry.required.filter((field) => field in properties)
  if (!required.length) {
    return null
  }
  return {
    properties: Object.fromEntries(required.map((field) => [field, properties[field]])),
    required: [...required],
    type: 'object',
  }
}

export const CreateWidgetModal = ({ onCancel, onCreate, open, widgetKind }: {
  onCancel: () => void
  /** The authored widget: the name both objects take, and the widgetData the CRD asked for. */
  onCreate: (result: { name: string; widgetData: Record<string, unknown> }) => void
  open: boolean
  widgetKind: string | null
}): React.ReactNode => {
  const [form] = Form.useForm()
  const [error, setError] = useState<string | null>(null)

  // A fresh drop is a fresh widget: carrying the last one's values forward would silently author a
  // BarChart with the previous chart's fields, which publishes cleanly and renders the wrong data.
  useEffect(() => {
    if (open) {
      form.resetFields()
      setError(null)
    }
  }, [form, open, widgetKind])

  if (!widgetKind) {
    return null
  }
  const schema = requiredSchema(widgetKind)

  const submit = () => {
    const values = form.getFieldsValue() as Record<string, unknown> & { krateoName?: string }
    const { krateoName, ...widgetData } = values
    const name = (krateoName ?? '').trim()
    if (!DNS_1123.test(name)) {
      setError('name must be lower-case letters, digits and dashes — it becomes the CR\'s name')
      return
    }
    const missing = (WIDGET_KINDS[widgetKind]?.required ?? []).filter((field) => {
      const value = widgetData[field]
      return value === undefined || value === null || value === ''
    })
    if (missing.length) {
      // Named rather than counted: "3 fields are required" sends someone hunting for which three.
      setError(`${widgetKind} requires ${missing.join(', ')} — the CRD rejects it without them`)
      return
    }
    onCreate({ name, widgetData })
  }

  return (
    <Modal okText='Create' onCancel={onCancel} onOk={submit} open={open} title={`Create a ${widgetKind}`} width={720}>
      {error ? <Alert message={error} showIcon style={{ marginBottom: 12 }} type='error' /> : null}
      <Typography.Paragraph type='secondary'>
        {schema
          ? `${widgetKind} needs these before it can be created — the names are the CRD's own. Everything else is editable in Files.`
          : `${widgetKind} needs nothing beyond a name.`}
      </Typography.Paragraph>
      <Form form={form} layout='vertical'>
        <Form.Item
          label='Name'
          name='krateoName'
          rules={[{ message: 'lower-case letters, digits and dashes', required: true }]}
        >
          <Input placeholder='fleet-throughput' />
        </Form.Item>
        {schema ? <SchemaForm schema={schema} /> : null}
      </Form>
    </Modal>
  )
}

export default CreateWidgetModal
