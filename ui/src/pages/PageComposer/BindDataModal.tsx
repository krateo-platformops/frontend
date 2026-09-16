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
 * VALIDATION IS THE FEATURE. What the author types lands inside a generated jq program, so the form
 * refuses anything outside a conservative path subset BY NAME rather than letting it become a
 * syntax error in code they did not write.
 */
import { Alert, Form, Input, Modal, Typography } from 'antd'
import { useState } from 'react'

import { generateBinding, validateBinding } from './generateBinding'
import type { BindingResult } from './generateBinding'

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
  const [error, setError] = useState<string | null>(null)

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
    const input = { apiPath, columns, itemsAt, name, namespace }
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
        <Form.Item
          help='Lower-case, dashes. Becomes the name of both the query and the table.'
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
          help='Column heading to the field it reads, as JSON. Paths only — .metadata.name, .status.conditions[0].type.'
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
      </Form>
    </Modal>
  )
}

export default BindDataModal
