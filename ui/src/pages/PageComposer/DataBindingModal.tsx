/**
 * Where a widget's data comes from, and what is done with it — the whole contract, in one place.
 *
 * A data-driven widget is three fields, and every one of the forty-four widget CRDs declares all
 * three: `apiRef` (which RESTAction), `widgetDataTemplate` (jq into widgetData paths), and
 * `resourcesRefsTemplate` (jq generating child refs). The composer exposed none of them. It offered
 * `bind-data`, which writes a RESTAction, an apiRef and exactly ONE widgetDataTemplate entry
 * (`forPath: dataSource`) from three questions over a single API path.
 *
 * That made a join look impossible — pod requests from the apiserver against live usage from
 * metrics.k8s.io could not be asked for, so it read as something only the agent could do. It never
 * was: the agent writes `spec.api[]` with `dependsOn` and a filter, which the CRD has always taken.
 * The difference was the door, not the platform.
 *
 * TWO ROUTES TO THE apiRef, because both are real: point at a RESTAction already on the cluster —
 * 92 of them are visible on the dev cluster, listed by the same `/list?category=` call the palette
 * makes for widgets — or write one into the draft, published with the page.
 *
 * NO OPINION ABOUT THE jq, anywhere in this form. Filters and expressions are programs; snowplow is
 * the only thing that can judge one, it answers a bad one by quoting the query and naming the
 * token, and the live preview already shows that message. Validating here would mean
 * re-implementing jq in the browser to produce a worse answer than the one already on the wire.
 */
import { Alert, Button, Form, Input, Modal, Radio, Select, Space, Tabs, Typography } from 'antd'
import { useEffect, useState } from 'react'

import { listPlaceableActions } from './placeableWidgets'
import type { PlaceableWidget } from './placeableWidgets'
import {
  generateRestAction, setApiRef, setDataTemplate, setRefsTemplate,
  validateDataTemplate, validateRefsTemplate,
} from './restActionDraft'
import type { ActionStep, DataTemplateEntry, RefsTemplateEntry } from './restActionDraft'

export interface DataBindingResult {
  /** The widget's YAML with apiRef / templates written. */
  widgetYaml: string
  /** A RESTAction to add to the draft, when the author authored one here. */
  restAction?: { path: string; content: string }
}

const blankStep = (): ActionStep => ({ name: '', path: '' })

export const DataBindingModal = ({ namespace, onCancel, onDone, open, snowplowBaseUrl, widgetName, widgetYaml }: {
  namespace: string
  onCancel: () => void
  onDone: (result: DataBindingResult) => void
  open: boolean
  snowplowBaseUrl: string
  widgetName: string
  widgetYaml: string
}): React.ReactNode => {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [actions, setActions] = useState<PlaceableWidget[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<ActionStep[]>([blankStep()])
  const [filter, setFilter] = useState('')
  const [templates, setTemplates] = useState<DataTemplateEntry[]>([{ expression: '', forPath: 'dataSource' }])
  const [refs, setRefs] = useState<RefsTemplateEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !snowplowBaseUrl || !namespace) {
      return
    }
    setError(null)
    void listPlaceableActions(snowplowBaseUrl, namespace).then((result) => {
      if (result.ok) {
        setActions(result.widgets)
        setListError(null)
      } else {
        // Said plainly. An empty picker that does not explain itself is the failure the widget
        // listing already learned to avoid.
        setListError(result.error)
      }
    })
  }, [namespace, open, snowplowBaseUrl])

  const submit = () => {
    let yaml = widgetYaml
    let restAction: DataBindingResult['restAction']

    if (mode === 'existing') {
      if (!picked) {
        setError('pick a RESTAction, or author a new one')
        return
      }
      // The RESTAction's OWN namespace — a picked one lives where the listing found it, and
      // rewriting that would point the widget at something that is not there.
      yaml = setApiRef(yaml, { name: picked, namespace })
    } else {
      const generated = generateRestAction({ filter, name, namespace, steps })
      if (!generated.ok) {
        setError(generated.error)
        return
      }
      restAction = generated.file
      yaml = setApiRef(yaml, { name: generated.name, namespace })
    }

    const filled = templates.filter((entry) => entry.forPath.trim() || entry.expression.trim())
    const dataError = validateDataTemplate(filled)
    if (dataError) {
      setError(dataError)
      return
    }
    if (filled.length) {
      yaml = setDataTemplate(yaml, filled)
    }

    const usedRefs = refs.filter((entry) => entry.iterator.trim() || entry.template.resource?.trim())
    const refsError = validateRefsTemplate(usedRefs)
    if (refsError) {
      setError(refsError)
      return
    }
    if (usedRefs.length) {
      yaml = setRefsTemplate(yaml, usedRefs)
    }

    onDone({ restAction, widgetYaml: yaml })
  }

  const stepRow = (step: ActionStep, index: number) => (
    <Space.Compact key={index} style={{ display: 'flex', marginBottom: 8 }}>
      <Input
        onChange={(event) => setSteps(steps.map((each, i) => (i === index ? { ...each, name: event.target.value } : each)))}
        placeholder='pods'
        style={{ width: 140 }}
        value={step.name}
      />
      <Input
        onChange={(event) => setSteps(steps.map((each, i) => (i === index ? { ...each, path: event.target.value } : each)))}
        placeholder='/api/v1/namespaces/krateo-system/pods'
        value={step.path}
      />
      <Select
        allowClear
        onChange={(value: string | undefined) => setSteps(steps.map((each, i) => (i === index ? { ...each, dependsOn: value } : each)))}
        options={steps.slice(0, index).map((prior) => ({ label: `after ${prior.name || '…'}`, value: prior.name }))}
        placeholder='runs first'
        style={{ width: 150 }}
        value={step.dependsOn}
      />
    </Space.Compact>
  )

  return (
    <Modal okText='Apply' onCancel={onCancel} onOk={submit} open={open} title={`Data for ${widgetName}`} width={860}>
      {error ? <Alert message={error} showIcon style={{ marginBottom: 12 }} type='error' /> : null}
      <Tabs
        items={[
          {
            children: (
              <>
                <Radio.Group
                  onChange={(event) => setMode(event.target.value as 'existing' | 'new')}
                  optionType='button'
                  options={[
                    { label: 'Use one that exists', value: 'existing' },
                    { label: 'Write a new one', value: 'new' },
                  ]}
                  style={{ marginBottom: 12 }}
                  value={mode}
                />
                {mode === 'existing' ? (
                  <>
                    {listError ? <Alert message={listError} showIcon type='warning' /> : null}
                    <Select
                      data-testid='action-picker'
                      onChange={setPicked}
                      options={actions.map((action) => ({ label: action.name, value: action.name }))}
                      placeholder='a RESTAction in this namespace'
                      showSearch
                      style={{ width: '100%' }}
                      value={picked}
                    />
                  </>
                ) : (
                  <Form layout='vertical'>
                    <Form.Item label='Name' required>
                      <Input onChange={(event) => setName(event.target.value)} placeholder='pod-sizing' value={name} />
                    </Form.Item>
                    <Form.Item
                      help='Each step is named, and a later one may depend on an earlier — that is how two sources are joined.'
                      label='API steps'
                      required
                    >
                      {steps.map(stepRow)}
                      <Button onClick={() => setSteps([...steps, blankStep()])} size='small'>Add a step</Button>
                    </Form.Item>
                    <Form.Item
                      help='jq over the steps, read back by name (.pods, .metrics). If it does not run, the preview shows what the server said.'
                      label='Filter'
                      required
                    >
                      <Input.TextArea
                        autoSize={{ maxRows: 16, minRows: 6 }}
                        onChange={(event) => setFilter(event.target.value)}
                        placeholder={'include "quantity";\n{ items: [ .pods.items[] | { … } ] }'}
                        value={filter}
                      />
                    </Form.Item>
                  </Form>
                )}
              </>
            ),
            key: 'source',
            label: 'Where the data comes from',
          },
          {
            children: (
              <>
                <Typography.Paragraph type='secondary'>
                  Each row fills one widgetData path from the RESTAction&rsquo;s result. A Table fills
                  <code> dataSource</code>; a chart fills its series; a Statistic fills one value.
                </Typography.Paragraph>
                {templates.map((entry, index) => (
                  <Space.Compact key={index} style={{ display: 'flex', marginBottom: 8 }}>
                    <Input
                      onChange={(event) => setTemplates(templates.map((row, i) => (i === index ? { ...row, forPath: event.target.value } : row)))}
                      placeholder='dataSource'
                      style={{ width: 200 }}
                      value={entry.forPath}
                    />
                    <Input.TextArea
                      autoSize={{ maxRows: 10, minRows: 2 }}
                      onChange={(event) => setTemplates(templates.map((row, i) => (i === index ? { ...row, expression: event.target.value } : row)))}
                      placeholder='[ .items[] | … ]'
                      value={entry.expression}
                    />
                  </Space.Compact>
                ))}
                <Button onClick={() => setTemplates([...templates, { expression: '', forPath: '' }])} size='small'>
                  Add a template
                </Button>
              </>
            ),
            key: 'data',
            label: 'What fills the widget',
          },
          {
            children: (
              <>
                <Typography.Paragraph type='secondary'>
                  Optional, and the one that generates a page&rsquo;s CHILDREN from data — one ref per
                  item, instead of a list written by hand.
                </Typography.Paragraph>
                {refs.map((entry, index) => (
                  <Space.Compact key={index} style={{ display: 'flex', marginBottom: 8 }}>
                    <Input
                      onChange={(event) => setRefs(refs.map((row, i) => (i === index ? { ...row, iterator: event.target.value } : row)))}
                      placeholder='.items[]'
                      style={{ width: 180 }}
                      value={entry.iterator}
                    />
                    <Input
                      onChange={(event) => setRefs(refs.map((row, i) => (i === index ? { ...row, template: { ...row.template, resource: event.target.value } } : row)))}
                      placeholder='cards'
                      style={{ width: 160 }}
                      value={entry.template.resource}
                    />
                    <Input
                      onChange={(event) => setRefs(refs.map((row, i) => (i === index ? { ...row, template: { ...row.template, name: event.target.value } } : row)))}
                      placeholder='.name'
                      value={entry.template.name}
                    />
                  </Space.Compact>
                ))}
                <Button onClick={() => setRefs([...refs, { iterator: '', template: {} }])} size='small'>
                  Add a refs template
                </Button>
              </>
            ),
            key: 'refs',
            label: 'Children from data',
          },
        ]}
      />
    </Modal>
  )
}

export default DataBindingModal
