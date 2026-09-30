/**
 * "Start a controller" (T8, frontend#412) — the mirror of StartChartModal. Name the controller; the
 * Kinds follow.
 *
 * THE BUILDER DECLARES THE FIELDS. Each label, help line and placeholder is the Controller Builder's
 * `spec.start.fields` entry of that name; what a value MEANS stays code (controllerChart.ts
 * validateStartController), as ADR 0001 says.
 *
 * THE DOCUMENT ARRIVES THREE WAYS — pasted, uploaded, or read once from a URL — and in each case it is
 * the same text, read by T7's parser as it is typed. A document that does not read says why in one
 * sentence, with its line. One over what a draft can hold beside its chart asks for the paths this
 * controller serves and is trimmed to them (T7's trimOas: their components and security schemes kept).
 *
 * THE DERIVED FACTS ARE SHOWN BEFORE START: what the document is, the group every Kind is served in,
 * and the CompositionDefinition the controller registers as. A Kind's group and name are CEL-immutable
 * once published, so they are read before the name is committed, not discovered after.
 *
 * THE ANSWER IS THE PROVIDER'S. Start emits the files on the chart-start bus as a controller draft; a
 * refusal (a draft is already open, the tree is over the cap) stays here, where it can be acted on.
 */
import { Alert, Button, Checkbox, Form, Input, Modal, Radio, Space, Upload } from 'antd'
import { useId, useMemo, useState } from 'react'

import type { StartField } from '../../builders/builderSpec'
import type { DraftRenderResultDetail } from '../../components/Autopilot/previewDraftRender'
import styles from '../BlueprintComposer/BlueprintComposer.module.css'

import { SPEC_BUDGET_BYTES } from './controllerChart'
import {
  readSpec, serverRewriteSentence, SPEC_TEXT_MAX_BYTES, startController, validateStartController,
  type StartControllerField, type StartControllerInput,
} from './controllerStart'
import { trimOas } from './oasImport'

type Source = 'paste' | 'upload' | 'url'

/** How long a URL read may take before it is abandoned. */
export const SPEC_FETCH_TIMEOUT_MS = 20_000

/**
 * Read a document from a URL, as nobody: no cookies or credentials ride along (`credentials: 'omit'`).
 * A declared Content-Length over the cap is refused before the body is read; a body that turns out
 * larger is refused too; and the whole read is abandoned after SPEC_FETCH_TIMEOUT_MS.
 */
export const readSpecUrl = async (url: string, timeoutMs = SPEC_FETCH_TIMEOUT_MS): Promise<{ text: string } | { problem: string }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const cap = `${SPEC_TEXT_MAX_BYTES / 1024 / 1024} MiB`
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal })
    if (!response.ok) {
      return { problem: `The URL answered ${response.status} — paste or upload the document instead.` }
    }
    const declared = Number(response.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > SPEC_TEXT_MAX_BYTES) {
      controller.abort()
      return { problem: `The URL serves ${Math.ceil(declared / 1024 / 1024)} MiB — over the ${cap} this builder reads. Nothing more was downloaded.` }
    }
    const text = await response.text()
    if (text.length > SPEC_TEXT_MAX_BYTES) {
      return { problem: `The URL served more than ${cap} — over what this builder reads.` }
    }
    return { text }
  } catch (error) {
    if (controller.signal.aborted) {
      return { problem: `The URL did not answer within ${Math.round(timeoutMs / 1000)} s — paste or upload the document instead.` }
    }
    return { problem: `This browser could not read the URL (${error instanceof Error ? error.message : String(error)}) — the server may not allow it. Paste or upload the document instead.` }
  } finally {
    clearTimeout(timer)
  }
}

const kib = (bytes: number): string => `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

export const StartControllerModal = ({ fields, onCancel, onStart, open, pending, refusal }: {
  /** The Builder's declared start fields — labels, help and placeholders by name. */
  fields: readonly StartField[]
  onCancel: () => void
  onStart: (files: Record<string, string>) => void
  open: boolean
  pending: boolean
  refusal: DraftRenderResultDetail | null
}) => {
  const [input, setInput] = useState<StartControllerInput>({ apiGroup: '', baseUrl: '', name: '', paths: null, spec: '' })
  const [source, setSource] = useState<Source>('paste')
  const [url, setUrl] = useState('')
  const [reading, setReading] = useState<{ busy: boolean; problem: string | null; from: string | null }>({ busy: false, from: null, problem: null })
  const [submitted, setSubmitted] = useState(false)
  const ids = { apiGroup: useId(), baseUrl: useId(), name: useId(), spec: useId(), url: useId() }

  const field = (name: string): StartField | undefined => fields.find((entry) => entry.name === name)
  const label = (name: string, fallback: string): string => field(name)?.label ?? fallback

  const spec = useMemo(() => readSpec(input.spec, input.baseUrl), [input.spec, input.baseUrl])
  // Parsed once per text or base URL — never again per keystroke in another field.
  const problems = useMemo(() => validateStartController(input, spec), [input, spec])
  const problemFor = (key: StartControllerField): string | undefined => {
    const typed = key === 'paths' ? input.spec.trim() !== '' : String(input[key] ?? '').trim() !== ''
    return submitted || typed ? problems.find((problem) => problem.field === key)?.message : undefined
  }
  const set = (key: 'name' | 'apiGroup' | 'baseUrl') => (event: React.ChangeEvent<HTMLInputElement>) =>
    setInput((current) => ({ ...current, [key]: event.target.value }))
  const setSpec = (text: string, from: string | null) => {
    setInput((current) => ({ ...current, paths: null, spec: text }))
    setReading({ busy: false, from, problem: null })
  }

  const readUrl = async () => {
    const target = url.trim()
    if (!/^https?:\/\//.test(target)) {
      setReading({ busy: false, from: null, problem: 'An http(s) URL.' })
      return
    }
    setReading({ busy: true, from: null, problem: null })
    const answer = await readSpecUrl(target)
    if ('text' in answer) {
      setSpec(answer.text, target)
    } else {
      setReading({ busy: false, from: null, problem: answer.problem })
    }
  }

  const submit = () => {
    setSubmitted(true)
    const result = startController(input, spec)
    if (result.ok) {
      onStart(result.files)
    }
  }

  const name = input.name.trim()
  const group = input.apiGroup.trim()
  const paths = spec.oas ? Object.keys((spec.oas.doc.paths ?? {})) : []
  const trimmed = spec.oas && input.paths ? trimOas(spec.oas.doc, input.paths, spec.oas.format) : null
  const specProblem = problemFor('spec') ?? reading.problem ?? undefined
  const specHelp = specProblem ?? (reading.from ? `Read from ${reading.from}.` : field('spec')?.help)
  const rewritten = spec.oas ? serverRewriteSentence(spec.oas.doc, input.baseUrl) : null

  return (
    <Modal
      cancelText='Cancel'
      confirmLoading={pending}
      okText='Start'
      onCancel={onCancel}
      onOk={submit}
      open={open}
      title={(
        <div className={styles.modalHeading}>
          <span className={styles.eyebrow}>Start a controller</span>
          <span className={styles.modalTitle}>Name the controller; the Kinds follow</span>
        </div>
      )}
      width={640}
    >
      <Form layout='vertical'>
        <Form.Item
          help={problemFor('name') ?? field('name')?.help}
          htmlFor={ids.name}
          label={label('name', 'Controller name')}
          required
          validateStatus={problemFor('name') ? 'error' : undefined}
        >
          <Input
            aria-invalid={problemFor('name') ? true : undefined}
            aria-required
            className={styles.mono}
            id={ids.name}
            onChange={set('name')}
            placeholder={field('name')?.placeholder}
            value={input.name}
          />
        </Form.Item>
        <Form.Item
          help={problemFor('apiGroup') ?? field('apiGroup')?.help}
          htmlFor={ids.apiGroup}
          label={label('apiGroup', 'API group')}
          required
          validateStatus={problemFor('apiGroup') ? 'error' : undefined}
        >
          <Input
            aria-invalid={problemFor('apiGroup') ? true : undefined}
            aria-required
            className={styles.mono}
            id={ids.apiGroup}
            onChange={set('apiGroup')}
            placeholder={field('apiGroup')?.placeholder}
            value={input.apiGroup}
          />
        </Form.Item>
        <Form.Item
          help={specHelp}
          htmlFor={ids.spec}
          label={label('spec', 'OpenAPI spec')}
          required
          validateStatus={specProblem ? 'error' : undefined}
        >
          <Space orientation='vertical' style={{ width: '100%' }}>
            <Radio.Group
              aria-label='Where the document comes from'
              onChange={(event) => setSource(event.target.value as Source)}
              optionType='button'
              options={[{ label: 'Paste', value: 'paste' }, { label: 'Upload', value: 'upload' }, { label: 'URL', value: 'url' }]}
              size='small'
              value={source}
            />
            {source === 'paste' ? (
              <Input.TextArea
                aria-invalid={specProblem ? true : undefined}
                aria-required
                className={styles.mono}
                id={ids.spec}
                onChange={(event) => setSpec(event.target.value, null)}
                placeholder='openapi: 3.0.3 …'
                rows={6}
                value={input.spec}
              />
            ) : null}
            {source === 'upload' ? (
              <Upload
                accept='.json,.yaml,.yml'
                beforeUpload={(file) => {
                  if (file.size > SPEC_TEXT_MAX_BYTES) {
                    setReading({ busy: false, from: null, problem: `${file.name} is ${Math.ceil(file.size / 1024 / 1024)} MiB — over the ${SPEC_TEXT_MAX_BYTES / 1024 / 1024} MiB this builder reads.` })
                    return false
                  }
                  void file.text().then((text) => setSpec(text, file.name))
                  return false
                }}
                maxCount={1}
                showUploadList={false}
              >
                <Button id={ids.spec}>Choose a file…</Button>
              </Upload>
            ) : null}
            {source === 'url' ? (
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  aria-label='Document URL'
                  className={styles.mono}
                  id={ids.spec}
                  onChange={(event) => setUrl(event.target.value)}
                  onPressEnter={() => { void readUrl() }}
                  placeholder='https://…/openapi.json'
                  value={url}
                />
                <Button loading={reading.busy} onClick={() => { void readUrl() }}>Read</Button>
              </Space.Compact>
            ) : null}
          </Space>
        </Form.Item>
        {spec.oas && (spec.overBudget || input.paths) ? (
          <Form.Item
            help={problemFor('paths') ?? (trimmed ? `Trimmed to ${counted(input.paths?.length ?? 0, 'path')}: ${kib(trimmed.bytes)} of the ${kib(SPEC_BUDGET_BYTES)} a draft can hold beside its chart.` : undefined)}
            label='Paths this controller serves'
            required
            validateStatus={problemFor('paths') ? 'error' : undefined}
          >
            <Checkbox.Group
              onChange={(values) => setInput((current) => ({ ...current, paths: values.map(String) }))}
              options={paths.map((path) => ({ label: <span className={styles.mono}>{path}</span>, value: path }))}
              value={input.paths ?? []}
            />
          </Form.Item>
        ) : null}
        <Form.Item
          help={problemFor('baseUrl') ?? field('baseUrl')?.help}
          htmlFor={ids.baseUrl}
          label={label('baseUrl', 'Base URL the controller calls')}
          required
          validateStatus={problemFor('baseUrl') ? 'error' : undefined}
        >
          <Input
            aria-invalid={problemFor('baseUrl') ? true : undefined}
            aria-required
            className={styles.mono}
            id={ids.baseUrl}
            onChange={set('baseUrl')}
            placeholder={field('baseUrl')?.placeholder}
            value={input.baseUrl}
          />
        </Form.Item>
      </Form>
      {rewritten ? <Alert showIcon title={rewritten} type='info' /> : null}
      <div className={styles.derivedList}>
        <span className={styles.eyebrow}>Derived — read before you commit to the name</span>
        <div className={styles.derived}>
          <span className={styles.derivedLabel}>Spec</span>
          <span className={styles.derivedValue} data-testid='derived-spec'>
            {spec.oas
              ? `OpenAPI ${spec.oas.summary.version} · ${spec.oas.summary.title || 'untitled'} · ${counted(spec.oas.summary.paths, 'path')} · ${counted(spec.oas.summary.operations, 'operation')} · ${counted(spec.oas.summary.securitySchemes.length, 'security scheme')} · ${kib(spec.bytes)}`
              : '—'}
          </span>
        </div>
        <div className={styles.derived}>
          <span className={styles.derivedLabel}>Kinds served as</span>
          <span className={styles.derivedValue} data-testid='derived-group'>{group ? `${group}/v1alpha1` : '—'}</span>
        </div>
        <div className={styles.derived}>
          <span className={styles.derivedLabel}>Registered as</span>
          <span className={styles.derivedValue} data-testid='derived-registration'>{name ? `CompositionDefinition ${name}` : '—'}</span>
        </div>
      </div>
      {refusal ? (
        <Alert
          description={refusal.problems?.length ? <ul>{refusal.problems.map((line) => <li key={line}>{line}</li>)}</ul> : undefined}
          showIcon
          title={refusal.message ?? 'The controller was not started.'}
          type='error'
        />
      ) : (
        <p className={styles.infoNote}>
          The draft is saved in your drafts as you work. Nothing is published before the change request.
        </p>
      )}
    </Modal>
  )
}

export default StartControllerModal
