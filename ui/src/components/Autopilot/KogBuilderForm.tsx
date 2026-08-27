/**
 * UI-NATIVE KOG BUILDER (item C) — the plain-form "New RestDefinition" authoring surface.
 *
 * Vincenzo item C: "molte funzionalità sono disponibili solo via Autopilot, ritengo sia importante
 * poter usare la UI anche." The Controller/API (KOG) builder could previously author a RestDefinition
 * ONLY through Autopilot. This modal is the UI-native path — a plain form the user fills — that reaches
 * the IDENTICAL publish machinery: on submit it builds the RestDefinition with the SAME functions
 * Autopilot uses (restDefinitionDraft → kogPublish) and dispatches through the SAME applyResourceSet
 * path, so the whole thing rides the IDENTICAL aggregated blast-radius confirm + git PR. Nothing lands
 * live; a human merges the PR.
 *
 * The OAS spec mirrors the Autopilot URL-vs-paste discriminator: an http(s):// URL is written straight
 * into spec.oasPath (no ConfigMap committed, oasgen fetches it); a pasted document is held in local
 * component state (never retyped, never sent to a model), the oasPath is a configmap:// reference, and
 * the held bytes are embedded into the committed ConfigMap manifest at publish-compile time.
 */

import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { App, Button, Form, Input, Modal, Select, Space, Tooltip, Typography } from 'antd'
import { useMemo, useState } from 'react'

import { useConfigContext } from '../../context/ConfigContext'

import { useKogBuilderPublish } from './kogBuilderPublish'
import { KOG_REPO_DEFAULTS } from './kogPublish'
import { createOasAttachment, OAS_ATTACHMENT_MAX_BYTES } from './oasAttachment'
import {
  emptyRestDefinitionInput,
  emptyVerbInput,
  REST_DEFINITION_ACTIONS,
  REST_DEFINITION_METHODS,
  type RestDefinitionDraftInput,
  type RestDefinitionVerbInput,
} from './restDefinitionDraft'

const { Paragraph, Text } = Typography

/** URL vs pasted-document — the same two OAS sources the Autopilot flow accepts. */
type OasMode = 'url' | 'paste'

/** The paste-case ConfigMap key the publish machinery commits (matches KOG_OAS_CONFIGMAP_KEY). */
const OAS_CONFIGMAP_KEY = 'openapi.yaml'

/** Build the configmap:// oasPath the paste case commits (namespace/name/key), mirroring kogPublish. */
const pasteOasPath = (namespace: string, name: string): string =>
  `configmap://${namespace.trim() || 'krateo-system'}/${(name.trim() || 'restdef')}-oas/${OAS_CONFIGMAP_KEY}`

export interface KogBuilderFormProps {
  open: boolean
  onClose: () => void
}

/**
 * Resolve the KOG publish destination default. Prefer an install-configured `owner/repo` slug
 * (config.api.AUTOPILOT_KOG_BUILDER_REPO — the same config key the Autopilot builder targets read)
 * so an org/repo rename is a values change, not a rebuild; fall back to the built-in KOG_REPO_DEFAULTS.
 * Read defensively off the loosely-typed config bag (the slug key is optional and may be absent).
 */
const resolveKogTarget = (config: ReturnType<typeof useConfigContext>['config']): { owner: string; repo: string } => {
  const slug = (config?.api as Record<string, string | undefined> | undefined)?.AUTOPILOT_KOG_BUILDER_REPO
  const parts = typeof slug === 'string' ? slug.trim().split('/') : []
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return { owner: parts[0].trim(), repo: parts[1].trim() }
  }
  return { owner: KOG_REPO_DEFAULTS.owner, repo: KOG_REPO_DEFAULTS.repo }
}

/**
 * The "New RestDefinition" modal. Self-contained: it owns the structured inputs (name/namespace/
 * resourceGroup/resource.kind/verbs), the OAS source (URL or held paste), and the publish
 * destination (repo coords, config-defaulted via resolveKogTarget), and drives useKogBuilderPublish
 * on submit. Validation errors are surfaced inline; the aggregated blast-radius confirm is the real
 * gate (owned by the reused dispatch path, not this component).
 */
export const KogBuilderForm = ({ onClose, open }: KogBuilderFormProps) => {
  const { message } = App.useApp()
  const { config } = useConfigContext()
  const kogTarget = useMemo(() => resolveKogTarget(config), [config])
  const { publish } = useKogBuilderPublish()

  const [input, setInput] = useState<RestDefinitionDraftInput>(emptyRestDefinitionInput)
  const [oasMode, setOasMode] = useState<OasMode>('url')
  const [oasUrl, setOasUrl] = useState('')
  const [oasPaste, setOasPaste] = useState('')
  const [owner, setOwner] = useState<string>(kogTarget.owner)
  const [repo, setRepo] = useState<string>(kogTarget.repo)
  const [base, setBase] = useState<string>(KOG_REPO_DEFAULTS.base)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const patch = (delta: Partial<RestDefinitionDraftInput>) => setInput((prev) => ({ ...prev, ...delta }))

  const setVerb = (index: number, delta: Partial<RestDefinitionVerbInput>) =>
    setInput((prev) => ({ ...prev, verbs: prev.verbs.map((verb, i) => (i === index ? { ...verb, ...delta } : verb)) }))

  const addVerb = () => setInput((prev) => ({ ...prev, verbs: [...prev.verbs, emptyVerbInput()] }))

  const removeVerb = (index: number) =>
    setInput((prev) => ({ ...prev, verbs: prev.verbs.length > 1 ? prev.verbs.filter((_, i) => i !== index) : prev.verbs }))

  // The paste-case size check reuses the SAME 512 KiB cap + guidance the Autopilot attachment enforces.
  const pasteError = useMemo(() => {
    if (oasMode !== 'paste' || !oasPaste.trim()) {
      return null
    }
    const held = createOasAttachment(oasPaste)
    return held.ok ? null : held.error
  }, [oasMode, oasPaste])

  const reset = () => {
    setInput(emptyRestDefinitionInput())
    setOasMode('url')
    setOasUrl('')
    setOasPaste('')
    setPrTitle('')
    setPrBody('')
    setErrors([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const onSubmit = async () => {
    setErrors([])
    if (pasteError) {
      setErrors([pasteError])
      return
    }
    // Compose the oasPath from the chosen source: the URL verbatim, or a configmap:// reference the
    // paste case commits. The held document (paste text) rides straight into the publish machinery.
    const oasPath = oasMode === 'url' ? oasUrl.trim() : pasteOasPath(input.namespace, input.name)
    const oasDocument = oasMode === 'paste' ? oasPaste : null
    const fullInput: RestDefinitionDraftInput = { ...input, oasPath }
    const coords = {
      base: base.trim() || undefined,
      body: prBody.trim() || undefined,
      owner: owner.trim() || undefined,
      repo: repo.trim() || undefined,
      title: prTitle.trim() || undefined,
    }
    setSubmitting(true)
    try {
      const outcome = await publish(fullInput, coords, oasDocument)
      if (!outcome.ok) {
        setErrors(outcome.errors)
        return
      }
      // outcome.chip === null → the human declined the blast-radius confirm (nothing dispatched).
      if (outcome.chip) {
        message.success('RestDefinition publish opened as a pull request — merge it to reconcile the new API kind.')
        close()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      cancelText='Cancel'
      confirmLoading={submitting}
      okText='Review & publish'
      onCancel={close}
      onOk={() => { void onSubmit() }}
      open={open}
      title='New RestDefinition (API mapping)'
      width={720}
    >
      <Paragraph type='secondary'>
        Author a Controller/API mapping from an OpenAPI spec, then publish it as a pull request — the
        same review + blast-radius confirm Autopilot uses. Nothing lands live; merging the PR lets the
        KOG provider reconcile the new API kind.
      </Paragraph>
      <Form layout='vertical'>
        <Space.Compact block>
          <Form.Item label='Kind name (metadata.name, DNS-1123)' style={{ width: '50%' }}>
            <Input onChange={(event) => patch({ name: event.target.value })} placeholder='mlflow-experiments' value={input.name} />
          </Form.Item>
          <Form.Item label='Namespace' style={{ width: '50%' }}>
            <Input onChange={(event) => patch({ namespace: event.target.value })} placeholder='krateo-system' value={input.namespace} />
          </Form.Item>
        </Space.Compact>

        <Space.Compact block>
          <Form.Item label='Resource group (DNS subdomain)' style={{ width: '50%' }}>
            <Input onChange={(event) => patch({ resourceGroup: event.target.value })} placeholder='mlflow.example.org' value={input.resourceGroup} />
          </Form.Item>
          <Form.Item label='Resource kind (CamelCase)' style={{ width: '50%' }}>
            <Input onChange={(event) => patch({ resourceKind: event.target.value })} placeholder='Experiment' value={input.resourceKind} />
          </Form.Item>
        </Space.Compact>

        <Form.Item label='OpenAPI spec'>
          <Select
            onChange={(value: OasMode) => setOasMode(value)}
            options={[{ label: 'From a URL (oasgen fetches it)', value: 'url' }, { label: 'Paste the document (held client-side, committed as a ConfigMap)', value: 'paste' }]}
            style={{ marginBottom: 8 }}
            value={oasMode}
          />
          {oasMode === 'url'
            ? <Input onChange={(event) => setOasUrl(event.target.value)} placeholder='https://raw.githubusercontent.com/…/openapi.yaml' value={oasUrl} />
            : (
              <>
                <Input.TextArea
                  autoSize={{ maxRows: 12, minRows: 6 }}
                  onChange={(event) => setOasPaste(event.target.value)}
                  placeholder='openapi: 3.0.0…'
                  status={pasteError ? 'error' : undefined}
                  value={oasPaste}
                />
                <Text type='secondary'>
                  Held in your browser and committed verbatim as a ConfigMap manifest — never sent to a model. Cap {Math.floor(OAS_ATTACHMENT_MAX_BYTES / 1024)} KiB; over that, host it and use a URL.
                </Text>
                {pasteError ? <div><Text type='danger'>{pasteError}</Text></div> : null}
              </>
            )}
        </Form.Item>

        <Form.Item label='Verbs (at least one {action, method, path})'>
          <Space orientation='vertical' style={{ width: '100%' }}>
            {input.verbs.map((verb, index) => (
              <Space.Compact block key={index}>
                <Select
                  onChange={(action) => setVerb(index, { action })}
                  options={REST_DEFINITION_ACTIONS.map((action) => ({ label: action, value: action }))}
                  style={{ width: 130 }}
                  value={verb.action}
                />
                <Select
                  onChange={(method) => setVerb(index, { method })}
                  options={REST_DEFINITION_METHODS.map((method) => ({ label: method, value: method }))}
                  style={{ width: 110 }}
                  value={verb.method}
                />
                <Input
                  onChange={(event) => setVerb(index, { path: event.target.value })}
                  placeholder='/api/2.0/mlflow/experiments/get'
                  value={verb.path}
                />
                <Button danger disabled={input.verbs.length === 1} onClick={() => removeVerb(index)}>Remove</Button>
              </Space.Compact>
            ))}
            <Button onClick={addVerb} type='dashed'>Add verb</Button>
          </Space>
        </Form.Item>

        <Typography.Title level={5}>Publish destination</Typography.Title>
        <Space.Compact block>
          <Form.Item label='Repository owner' style={{ width: '34%' }}>
            <Input onChange={(event) => setOwner(event.target.value)} value={owner} />
          </Form.Item>
          <Form.Item label='Repository' style={{ width: '33%' }}>
            <Input onChange={(event) => setRepo(event.target.value)} value={repo} />
          </Form.Item>
          <Form.Item label='Base branch' style={{ width: '33%' }}>
            <Input onChange={(event) => setBase(event.target.value)} value={base} />
          </Form.Item>
        </Space.Compact>
        <Form.Item label='PR title (optional)'>
          <Input onChange={(event) => setPrTitle(event.target.value)} placeholder={`feat(${input.name.trim() || '<kind>'}): add ${input.name.trim() || '<kind>'} RestDefinition`} value={prTitle} />
        </Form.Item>
        <Form.Item label='PR body (optional)'>
          <Input.TextArea autoSize={{ maxRows: 4, minRows: 2 }} onChange={(event) => setPrBody(event.target.value)} value={prBody} />
        </Form.Item>

        {errors.length > 0
          ? (
            <div data-testid='kog-builder-errors'>
              {errors.map((err, index) => <div key={index}><Text type='danger'>{err}</Text></div>)}
            </div>
          )
          : null}
      </Form>
    </Modal>
  )
}

export default KogBuilderForm

/**
 * The header launcher for the UI-native KOG builder — a plain icon button that opens the
 * "New RestDefinition" modal. Lives in the app-shell header chrome (like CommandPalette /
 * AutopilotToggle), so a UI-native API-mapping authoring path is reachable from anywhere
 * WITHOUT Autopilot. The modal mounts only while open (state-owned here).
 */
export const KogBuilderTrigger = () => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip title='New RestDefinition (API mapping)'>
        <Button
          aria-label='New RestDefinition (API mapping)'
          icon={<FontAwesomeIcon icon={['fas', 'plug-circle-plus'] as IconProp} />}
          onClick={() => setOpen(true)}
          type='text'
        />
      </Tooltip>
      {open ? <KogBuilderForm onClose={() => setOpen(false)} open={open} /> : null}
    </>
  )
}
