/**
 * UI-NATIVE BLUEPRINT BUILDER (item C, blueprint slice) — the plain-form "Import blueprint" surface.
 *
 * Vincenzo item C: "molte funzionalità sono disponibili solo via Autopilot, ritengo sia importante
 * poter usare la UI anche." The blueprint publish could previously reach a git PR ONLY through the
 * Autopilot `publishBlueprint` flow. This modal is the UI-native path — a plain IMPORT form: the user
 * brings their OWN Helm chart tree (Upload/paste, read client-side), and on submit it publishes via
 * the IDENTICAL git-write machinery (buildBlueprintPublishOps → applyResourceSet) — the same aggregated
 * blast-radius confirm + git PR. Nothing lands live; a human merges the PR.
 *
 * Unlike the KOG builder (which AUTHORS a RestDefinition from fields), this is bring-your-own-files:
 * the chart tree is held client-side in the SAME `{path: content}` shape the Autopilot builder holds,
 * and published verbatim.
 */

import { App, Form, Input, Modal, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'

import { useConfigContext } from '../../context/ConfigContext'

import { useBlueprintBuilderPublish } from './blueprintBuilderPublish'
import { BLUEPRINTS_REPO_DEFAULTS } from './blueprintPublish'
import { validateImportedTree } from './builderImport'
import { BuilderImportField } from './BuilderImportField'

const { Paragraph, Text } = Typography

export interface BlueprintBuilderFormProps {
  open: boolean
  onClose: () => void
}

/**
 * Resolve the blueprint publish destination default. Prefer an install-configured `owner/repo` slug
 * (config.api.AUTOPILOT_BLUEPRINT_BUILDER_REPO — the same config key the Autopilot builder targets
 * read) so an org/repo rename is a values change, not a rebuild; fall back to BLUEPRINTS_REPO_DEFAULTS.
 * Read defensively off the loosely-typed config bag (the slug key is optional and may be absent — the
 * base branch may predate builderTargets.ts).
 */
const resolveBlueprintTarget = (config: ReturnType<typeof useConfigContext>['config']): { owner: string; repo: string } => {
  const slug = (config?.api as Record<string, string | undefined> | undefined)?.AUTOPILOT_BLUEPRINT_BUILDER_REPO
  const parts = typeof slug === 'string' ? slug.trim().split('/') : []
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return { owner: parts[0].trim(), repo: parts[1].trim() }
  }
  return { owner: BLUEPRINTS_REPO_DEFAULTS.owner, repo: BLUEPRINTS_REPO_DEFAULTS.repo }
}

/**
 * The "Import blueprint" modal. Self-contained: it owns the imported chart tree (via BuilderImportField),
 * the publish destination (repo coords, config-defaulted via resolveBlueprintTarget), and drives
 * useBlueprintBuilderPublish on submit. Validation errors are surfaced inline; the aggregated
 * blast-radius confirm is the real gate (owned by the reused dispatch path, not this component).
 */
export const BlueprintBuilderForm = ({ onClose, open }: BlueprintBuilderFormProps) => {
  const { message } = App.useApp()
  const { config } = useConfigContext()
  const target = useMemo(() => resolveBlueprintTarget(config), [config])
  const { publish } = useBlueprintBuilderPublish()

  const [files, setFiles] = useState<Record<string, string>>({})
  const [owner, setOwner] = useState<string>(target.owner)
  const [repo, setRepo] = useState<string>(target.repo)
  const [base, setBase] = useState<string>(BLUEPRINTS_REPO_DEFAULTS.base)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setFiles({})
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
    // Form-level gate: non-empty, under-cap, every file parses as YAML. The publish compiler
    // re-checks the cap/scope + requires a Chart.yaml (defense in depth).
    const validation = validateImportedTree(files)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    const coords = {
      base: base.trim() || undefined,
      body: prBody.trim() || undefined,
      owner: owner.trim() || undefined,
      repo: repo.trim() || undefined,
      title: prTitle.trim() || undefined,
    }
    setSubmitting(true)
    try {
      const outcome = await publish(files, coords)
      if (!outcome.ok) {
        setErrors(outcome.errors)
        return
      }
      // outcome.chip === null → the human declined the blast-radius confirm (nothing dispatched).
      if (outcome.chip) {
        message.success('Blueprint import opened as a pull request — merge it to add the blueprint.')
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
      title='Import blueprint (Helm chart)'
      width={720}
    >
      <Paragraph type='secondary'>
        Import an existing Helm chart tree (must include a <Text code>Chart.yaml</Text>) and publish it
        as a pull request — the same review + blast-radius confirm Autopilot uses. Files are held in
        your browser and committed verbatim; nothing lands live until the PR merges.
      </Paragraph>
      <Form layout='vertical'>
        <Form.Item label='Chart files'>
          <BuilderImportField files={files} onChange={setFiles} pastePathPlaceholder='Chart.yaml' />
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
          <Input onChange={(event) => setPrTitle(event.target.value)} placeholder='feat: add <chart> blueprint' value={prTitle} />
        </Form.Item>
        <Form.Item label='PR body (optional)'>
          <Input.TextArea autoSize={{ maxRows: 4, minRows: 2 }} onChange={(event) => setPrBody(event.target.value)} value={prBody} />
        </Form.Item>

        {errors.length > 0
          ? (
            <div data-testid='blueprint-builder-errors'>
              {errors.map((err, index) => <div key={index}><Text type='danger'>{err}</Text></div>)}
            </div>
          )
          : null}
      </Form>
    </Modal>
  )
}

export default BlueprintBuilderForm
