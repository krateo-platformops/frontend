/**
 * "Bind data" — the form that reaches the half of the corpus the builder could never author.
 *
 * It asks three things and never says the word jq: where the data comes from, where the list lives
 * inside the response, and what the columns are. From that, `generateBinding` writes BOTH the
 * RESTAction and the widget bound to it, because either alone is useless — a widget without its
 * RESTAction is inert, a RESTAction without its widget is invisible.
 *
 * COLUMNS AS A JSON OBJECT, not a repeatable row. `SchemaFields` has no `Form.List`, and this page
 * is React rather than a Form widget, so it could have had one — but a key/value textarea is what
 * the author will paste from a `kubectl -o json` anyway, and it round-trips with what the Files tab
 * shows. A grid of inputs would be more chrome for the same information.
 *
 * CONTAINMENT IS THE FEATURE; CORRECTNESS IS THE SERVER'S. What the author types lands inside a
 * generated jq program, so the form refuses anything that could reach PAST the parentheses it is
 * wrapped in — an unbalanced bracket rewrites the program around it. It no longer refuses
 * expressions for being expressions. It used to, on the grounds that a mistake would leave the
 * author debugging code they never saw; snowplow disproves that by quoting the query and naming
 * the token, and the live preview shows them those words. See `isContainedExpression`.
 */
import { Alert, Form, Input, Modal, Select, Typography } from 'antd'
import { useState } from 'react'

import { dataPathFor, generateBinding, validateBinding } from './generateBinding'
import type { BindingResult } from './generateBinding'
import { WIDGET_KINDS } from './widgetKinds.generated'

const PLACEHOLDER = `{
  "Name":   ".metadata.name",
  "Status": ".status.conditions[0].type"
}`

export const BindDataModal = ({ namespace, onCancel, onGenerate, open }: {
  /**
   * The namespace both generated objects are created in, read from the draft by the caller.
   *
   * Null when the draft declares none, and then this refuses to generate rather than emitting a
   * pair without one: `spec.apiRef.namespace` is required by the Table CRD with no default, so a
   * namespace-less widget is rejected at apply — and js-yaml drops the undefined key silently, so
   * nothing between here and the cluster would have said a word.
   */
  namespace: string | null
  onCancel: () => void
  onGenerate: (result: Extract<BindingResult, { ok: true }>) => void
  open: boolean
}) => {
  const [name, setName] = useState('')
  const [apiPath, setApiPath] = useState('')
  const [itemsAt, setItemsAt] = useState('.items')
  const [columnsText, setColumnsText] = useState('')
  /**
   * WHICH KIND to bind. It was always a Table, and not because anything required that: every widget
   * CRD carries `spec.apiRef`, so the restriction lived entirely in the emitter. At forty-four
   * creatable kinds it was the difference between "create any widget" and "create any widget, then
   * hand-write its YAML to give it data".
   */
  const [kind, setKind] = useState('Table')
  /** A chart's xField/yField and anything else its CRD requires beyond the list itself. */
  const [extraText, setExtraText] = useState('')
  const [error, setError] = useState<string | null>(null)

  /**
   * What the EMITTER already writes, so the form does not ask for it.
   *
   * A Table requires `allowedResources` and `columns`, and generateBinding supplies both — asking
   * the author for them would make the one flow that already worked stop working. The remainder is
   * the genuinely author-only part: a chart's xField/yField, which no amount of schema-reading can
   * derive because "which mapped column is the x axis" is a decision, not a fact.
   */
  const emitted = new Set(['allowedResources', 'columns'])

  /** Only kinds with somewhere for a fetched list to land — see dataPathFor. */
  const bindableKinds = Object.keys(WIDGET_KINDS).filter((candidate) => dataPathFor(candidate)).sort()

  /**
   * What this kind needs BEYOND the list — its required fields less the array the binding fills.
   *
   * A LineChart requires data, xField and yField; the binding provides `data`, and which mapped
   * column is the x axis is a question only the author can answer. Guessing it publishes cleanly
   * and plots the wrong thing.
   */
  const extraRequired = (WIDGET_KINDS[kind]?.required ?? [])
    .filter((field) => !emitted.has(field) && field !== dataPathFor(kind))

  const submit = () => {
    let columns: Record<string, string>
    try {
      const parsed: unknown = JSON.parse(columnsText || '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('columns must be a JSON object of "Column title": ".field.path"')
        return
      }
      columns = parsed as Record<string, string>
    } catch {
      // Said plainly: the alternative is a generated filter that fails somewhere the author
      // cannot see, long after this form closed.
      setError('columns is not valid JSON')
      return
    }

    if (!namespace) {
      setError('this draft declares no namespace — open a page draft before binding data')
      return
    }
    let extraWidgetData: Record<string, unknown> = {}
    if (extraRequired.length) {
      try {
        const parsed: unknown = JSON.parse(extraText || '{}')
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setError(`${kind} needs ${extraRequired.join(', ')} as a JSON object`)
          return
        }
        extraWidgetData = parsed as Record<string, unknown>
      } catch {
        setError(`${kind}'s extra fields are not valid JSON`)
        return
      }
      const missing = extraRequired.filter((field) => extraWidgetData[field] === undefined)
      if (missing.length) {
        // Named, not counted: the CRD rejects the widget without them and that surfaces at publish.
        setError(`${kind} also requires ${missing.join(', ')} — the CRD rejects it without them`)
        return
      }
    }
    const input = { apiPath, columns, extraWidgetData, itemsAt, kind, name, namespace }
    const invalid = validateBinding(input)
    if (invalid) {
      setError(invalid)
      return
    }
    const result = generateBinding(input)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onGenerate(result)
  }

  return (
    <Modal okText='Generate' onCancel={onCancel} onOk={submit} open={open} title='Bind data' width={720}>
      <Typography.Paragraph type='secondary'>
        Reads from the cluster and renders a table. Both the query and the widget are generated —
        you review them in Files before anything is published.
      </Typography.Paragraph>
      <Form layout='vertical'>
        {/*
          WHICH KIND. It was always a Table — not because anything required that, but because the
          emitter could only make one. Every widget CRD carries `spec.apiRef`, so the restriction
          was ours. Only kinds with somewhere for a fetched list to land are offered: a Paragraph
          takes text, and binding one would write a template that goes nowhere.
        */}
        <Form.Item help='Only kinds that take a list can be bound to one.' label='Widget kind' required>
          <Select
            onChange={setKind}
            options={bindableKinds.map((candidate) => ({ label: candidate, value: candidate }))}
            showSearch
            value={kind}
          />
        </Form.Item>
        <Form.Item
          help='Lower-case, dashes. Becomes the name of both the query and the widget.'
          label='Name'
          required
        >
          <Input onChange={(event) => setName(event.target.value)} placeholder='fleet-failing' value={name} />
        </Form.Item>
        <Form.Item
          help='An apiserver path, not a URL. e.g. /apis/composition.krateo.io/v1alpha1/namespaces/krateo-system/fireworksapps'
          label='Where does the data come from?'
          required
        >
          <Input onChange={(event) => setApiPath(event.target.value)} placeholder='/apis/…' value={apiPath} />
        </Form.Item>
        <Form.Item
          help='Where the list lives in the response. .items for a Kubernetes list; . when the response is itself the list.'
          label='The list is at'
          required
        >
          <Input onChange={(event) => setItemsAt(event.target.value)} value={itemsAt} />
        </Form.Item>
        <Form.Item
          help='Column heading to what it reads, as JSON. A field path like .metadata.name, or an expression — [.spec.containers[].name] | join(", "). If it does not resolve, the preview shows what the server said.'
          label='Columns'
          required
        >
          <Input.TextArea
            autoSize={{ maxRows: 12, minRows: 5 }}
            onChange={(event) => setColumnsText(event.target.value)}
            placeholder={PLACEHOLDER}
            value={columnsText}
          />
        </Form.Item>
        {error ? <Alert showIcon title={error} type='error' /> : null}
        {extraRequired.length ? (
          <Form.Item
            help={`Keyed by the column titles above — a chart's xField names a key in the data.`}
            label={`${kind} also needs ${extraRequired.join(', ')}`}
            required
          >
            <Input.TextArea
              autoSize={{ maxRows: 6, minRows: 2 }}
              onChange={(event) => setExtraText(event.target.value)}
              placeholder={`{${extraRequired.map((field) => `"${field}": ""`).join(', ')}}`}
              value={extraText}
            />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  )
}

export default BindDataModal
