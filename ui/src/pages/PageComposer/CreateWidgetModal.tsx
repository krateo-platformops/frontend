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

import { dismissButtonProps } from '../../components/DismissButton'
import { color } from '../../theme/tokens'
import { SchemaForm } from '../../widgets/Form/SchemaFields'

import { DNS_1123 } from './composeAuthoring'
import { WIDGET_KINDS } from './widgetKinds.generated'

// The name rule lives with the authoring ops, so a person's drop form and an agent's addWidget
// cannot disagree about what a legal name is.

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

/**
 * The names a PieChart `colorMap` value may take — every key `getColorCode` resolves, which is what
 * PieChart calls on each value. Read from the token table itself, so a colour added there is
 * offered here with no change; a name outside it renders as the fallback ink, never as the colour
 * the author meant, which is why the choice is closed.
 */
export const PALETTE_NAMES: readonly string[] = Object.keys(color)

/**
 * Optional fields a kind's create form asks for as well, each with the schema the form should use.
 *
 * Kept to fields whose value comes from a vocabulary the author cannot see from the CRD: `colorMap`
 * is `additionalProperties: {type: string}` there, and the strings that work are the theme's token
 * names. Offered in the form's Advanced section, as every optional field is.
 */
const CREATE_EXTRAS: Record<string, Record<string, (node: JSONSchema4) => JSONSchema4>> = {
  PieChart: {
    colorMap: (node) => ({
      ...node,
      additionalProperties: {
        ...(typeof node.additionalProperties === 'object' ? node.additionalProperties : {}),
        enum: [...PALETTE_NAMES],
        type: 'string',
      },
    }),
  },
}

/** What the create form renders: the required fields, plus the kind's `CREATE_EXTRAS`. */
export const createSchema = (widgetKind: string): JSONSchema4 | null => {
  const base = requiredSchema(widgetKind)
  const extras = CREATE_EXTRAS[widgetKind]
  const properties = ((WIDGET_KINDS[widgetKind]?.schema as unknown as JSONSchema4 | undefined)?.properties ?? {}) as Record<string, JSONSchema4>
  const added = Object.entries(extras ?? {}).filter(([field]) => field in properties)
  if (!added.length) {
    return base
  }
  return {
    properties: {
      ...(base?.properties ?? {}),
      ...Object.fromEntries(added.map(([field, shape]) => [field, shape(properties[field])])),
    },
    required: [...((base?.required as string[] | undefined) ?? [])],
    type: 'object',
  }
}

/**
 * Drop what the form holds but the author never said: an `undefined` field, and a list row added
 * and left blank. js-yaml refuses to dump `undefined`, and an empty row is not a column.
 */
const prune = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(prune).filter((entry) => entry !== undefined
      && !(typeof entry === 'object' && entry !== null && !Array.isArray(entry) && !Object.keys(entry).length))
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [key, prune(entry)] as const)
      .filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''))
  }
  return value
}

/**
 * A list row missing a field its ITEM schema requires, named — "columns 2 needs valueKey". The
 * rows are CRD objects in their own right, and the strict CRD rejects a column without a
 * `valueKey` at apply, far from the form that could have said so.
 */
const incompleteRow = (widgetKind: string, widgetData: Record<string, unknown>): string | null => {
  const properties = ((WIDGET_KINDS[widgetKind]?.schema as unknown as JSONSchema4 | undefined)?.properties ?? {}) as Record<string, JSONSchema4>
  for (const [field, rows] of Object.entries(widgetData)) {
    const items = properties[field]?.items
    const needed = items && !Array.isArray(items) && Array.isArray(items.required) ? items.required : []
    if (!Array.isArray(rows) || !needed.length) {
      continue
    }
    for (const [index, row] of rows.entries()) {
      const missing = needed.filter((key) => {
        const present = (row as Record<string, unknown>)?.[key]
        return present === undefined || present === null || present === ''
      })
      if (missing.length) {
        return `${field} ${index + 1} needs ${missing.join(', ')} — the CRD rejects a row without it`
      }
    }
  }
  return null
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
  const schema = createSchema(widgetKind)

  const submit = () => {
    const values = form.getFieldsValue() as Record<string, unknown> & { krateoName?: string }
    const { krateoName, ...held } = values
    const widgetData = prune(held) as Record<string, unknown>
    const name = (krateoName ?? '').trim()
    if (!DNS_1123.test(name)) {
      setError('name must be lower-case letters, digits and dashes — it becomes the CR\'s name')
      return
    }
    /*
     * AN UNTOUCHED REQUIRED ARRAY IS `[]`, NOT A MISSING ANSWER — and getting this wrong made
     * fourteen of the forty-four kinds impossible to create, Table and all four charts among them.
     *
     * The CRD requires the KEY to be present; `[]` satisfies it, and `[]` is what every Table the
     * portal ships actually sets `allowedResources` to. The check below could not tell "the author
     * has nothing to say here" from "the author has not answered yet", so it refused the drop with
     * a message no amount of typing could clear — the only way through was to add a tag and then
     * delete it, which leaves exactly the `[]` this now writes.
     *
     * It is worse than fiddly on the data-bearing kinds. A Table's `columns` and a chart's `data`
     * are the fields `widgetDataTemplate` FILLS from the RESTAction's result; demanding them at
     * drop time asks the author to hand-write the very thing they are about to bind.
     *
     * Scalars are untouched: a required string that is still blank is a missing answer, and the
     * refusal below is the right one.
     */
    const properties = (WIDGET_KINDS[widgetKind]?.schema as { properties?: Record<string, { type?: string }> })?.properties ?? {}
    for (const field of WIDGET_KINDS[widgetKind]?.required ?? []) {
      if (widgetData[field] === undefined && properties[field]?.type === 'array') {
        widgetData[field] = []
      }
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
    const rowError = incompleteRow(widgetKind, widgetData)
    if (rowError) {
      setError(rowError)
      return
    }
    onCreate({ name, widgetData })
  }

  return (
    <Modal cancelButtonProps={dismissButtonProps} okText='Create' onCancel={onCancel} onOk={submit} open={open} title={`Create a ${widgetKind}`} width={720}>
      {error ? <Alert message={error} showIcon style={{ marginBottom: 'var(--spacing-smd)' }} type='error' /> : null}
      <Typography.Paragraph type='secondary'>
        {schema
          ? `${widgetKind} needs these before it can be created — the names are the CRD's own. A list may be left empty when data binding will fill it. Everything else is editable in Files.`
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
