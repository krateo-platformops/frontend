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
 * TWO ROUTES TO THE apiRef, because both are real: point at a RESTAction that already exists — or
 * write one into the draft, published with the page.
 *
 * "EXISTS" MEANS THE DRAFT TOO. The picker listed only the cluster (the same `/list?category=` call
 * the palette makes for widgets — 92 on the dev cluster), and a RESTAction authored in this draft
 * is not on the cluster until the page publishes. So a page with a pie and a table over ONE query
 * could not be built here: the second widget could not pick the first one's RESTAction, and the
 * apiRef had to be hand-written in Files. The draft's own are offered first, in their own group.
 *
 * NO OPINION ABOUT THE jq, anywhere in this form. Filters and expressions are programs; snowplow is
 * the only thing that can judge one, it answers a bad one by quoting the query and naming the
 * token, and the live preview already shows that message. Validating here would mean
 * re-implementing jq in the browser to produce a worse answer than the one already on the wire.
 */
import { Alert, AutoComplete, Button, Form, Input, Modal, Radio, Select, Space, Tabs, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import { draftActions } from './objectTree'
import { listPlaceableActions } from './placeableWidgets'
import type { PlaceableWidget } from './placeableWidgets'
import {
  dataPathsFor, generateRestAction, setApiRef, setDataTemplate, setRefsTemplate,
  validateDataTemplate, validateRefsTemplate, widgetKindOf,
} from './restActionDraft'
import type { ActionStep, DataTemplateEntry, RefsTemplateEntry } from './restActionDraft'

export interface DataBindingResult {
  /** The widget's YAML with apiRef / templates written. */
  widgetYaml: string
  /** A RESTAction to add to the draft, when the author authored one here. */
  restAction?: { path: string; content: string }
}

const blankStep = (): ActionStep => ({ name: '', path: '' })

/**
 * A picker value names its SOURCE as well as the RESTAction: a draft may carry a RESTAction whose
 * name is also on the cluster (an earlier publish of the same page), and the two resolve to
 * different namespaces. A bare name would make them one option and pick whichever was listed last.
 */
const DRAFT_PREFIX = 'draft:'
const CLUSTER_PREFIX = 'cluster:'

export const DataBindingModal = ({ files = {}, namespace, onCancel, onDone, open, snowplowBaseUrl, widgetName, widgetYaml }: {
  /** The held draft — its RESTActions are offered before the cluster's. */
  files?: Record<string, string>
  namespace: string
  onCancel: () => void
  onDone: (result: DataBindingResult) => void
  open: boolean
  snowplowBaseUrl: string
  widgetName: string
  widgetYaml: string
}): React.ReactNode => {
  const inDraft = useMemo(() => draftActions(files), [files])
  const { initial: initialPath, paths: dataPaths } = useMemo(() => dataPathsFor(widgetKindOf(widgetYaml)), [widgetYaml])
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [actions, setActions] = useState<PlaceableWidget[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<ActionStep[]>([blankStep()])
  const [filter, setFilter] = useState('')
  const [templates, setTemplates] = useState<DataTemplateEntry[]>([{ expression: '', forPath: initialPath }])
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
      if (picked.startsWith(DRAFT_PREFIX)) {
        const actionName = picked.slice(DRAFT_PREFIX.length)
        // The draft's RESTAction: its own namespace when the file names a real one, otherwise
        // the one a RESTAction written here gets — both publish with the page into the same place.
        const own = inDraft.find((action) => action.name === actionName)?.namespace
        yaml = setApiRef(yaml, { name: actionName, namespace: own ?? namespace })
      } else {
        // The RESTAction's OWN namespace — a picked one lives where the listing found it, and
        // rewriting that would point the widget at something that is not there.
        yaml = setApiRef(yaml, { name: picked.slice(CLUSTER_PREFIX.length), namespace })
      }
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
                    {/* The cluster listing failing says so, but no longer empties the picker: the
                        draft's own RESTActions need no request and stay offered. */}
                    {listError ? <Alert message={listError} showIcon style={{ marginBottom: 8 }} type='warning' /> : null}
                    <Select
                      data-testid='action-picker'
                      onChange={setPicked}
                      optionFilterProp='label'
                      options={[
                        ...(inDraft.length
                          ? [{
                            label: 'In this draft',
                            options: inDraft.map((action) => ({ label: action.name, value: `${DRAFT_PREFIX}${action.name}` })),
                          }]
                          : []),
                        ...(actions.length
                          ? [{
                            label: 'On the cluster',
                            options: actions.map((action) => ({ label: action.name, value: `${CLUSTER_PREFIX}${action.name}` })),
                          }]
                          : []),
                      ]}
                      placeholder={inDraft.length ? 'a RESTAction in this draft or this namespace' : 'a RESTAction in this namespace'}
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
                  Each row fills one widgetData path with a field of the RESTAction&rsquo;s result —
                  a Table&rsquo;s <code>dataSource</code>, a chart&rsquo;s <code>data</code>, a
                  Statistic&rsquo;s <code>value</code>. The path list is this widget&rsquo;s own; a
                  nested path such as <code>series[0].data</code> can be typed.
                </Typography.Paragraph>
                {templates.map((entry, index) => (
                  <Space.Compact key={index} style={{ display: 'flex', marginBottom: 8 }}>
                    {/* AutoComplete, not Select: the list is the kind's top-level fields, and a
                        nested path is a legitimate target the list cannot enumerate. */}
                    <AutoComplete
                      aria-label={`widgetData path ${index + 1}`}
                      filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())}
                      onChange={(value: string) => setTemplates(templates.map((row, i) => (i === index ? { ...row, forPath: value } : row)))}
                      options={dataPaths.map((path) => ({ label: path, value: path }))}
                      placeholder={initialPath || 'dataSource'}
                      style={{ width: 200 }}
                      value={entry.forPath}
                    />
                    <Input.TextArea
                      aria-label={`expression ${index + 1}`}
                      autoSize={{ maxRows: 10, minRows: 2 }}
                      onChange={(event) => setTemplates(templates.map((row, i) => (i === index ? { ...row, expression: event.target.value } : row)))}
                      placeholder={initialPath === 'data' ? '.items' : '[ .items[] | … ]'}
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
