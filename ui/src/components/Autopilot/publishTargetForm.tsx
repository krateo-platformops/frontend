/**
 * The PUBLISH DESTINATION form — the human declares WHERE a publish commits (owner /
 * repository / base branch) in a proper form BEFORE any git-write set is assembled. The
 * model's fence coords (and the builder defaults) are only PREFILLS: the destination is
 * user-owned and asked at every publish; the last confirmed choice prefills the next ask.
 *
 * Wiring mirrors the preview drawer's global-overlay pattern: ONE host mounted by
 * AutopilotProvider, driven by a promise-based request seam so the (non-React) publish
 * branches can await the human's answer. HEADLESS-SAFE: with no mounted host (unit tests,
 * non-UI callers) the request resolves to its prefills, keeping those flows
 * non-interactive and byte-identical to the pre-form behavior.
 */
import { Form, Input, Modal, Typography } from 'antd'
import { useEffect, useState } from 'react'

export interface PublishTarget {
  owner: string
  repo: string
  base: string
}

export interface PublishTargetRequest extends PublishTarget {
  /** What is being published — labels the form (a page, a blueprint chart, or a KOG API mapping). */
  kind: 'page' | 'blueprint' | 'restdef'
}

/** Human noun for the artifact kind (form title). Keep in sync with the kind union. */
const KIND_NOUN: Record<PublishTargetRequest['kind'], string> = {
  blueprint: 'blueprint',
  page: 'page',
  restdef: 'API mapping',
}

/** The write-gate blurb for the artifact kind — what a publish of THIS kind actually commits. */
const KIND_BLURB: Record<PublishTargetRequest['kind'], string> = {
  blueprint: 'The Helm chart tree (Chart.yaml, values.schema.json, templates/) is pushed to a branch and opened as a change request into the base branch — once merged, CI publishes it as a versioned OCI chart. Nothing merges without your review.',
  page: 'Autopilot pushes to a branch and opens a change request into the base branch — nothing merges without your review. Confirm the destination, or point it somewhere else.',
  restdef: 'The RestDefinition (and, for a pasted spec, its OpenAPI ConfigMap) is pushed to a branch and opened as a change request into the base branch — once merged, the controller provider reconciles it and the new API kind becomes available. The kind no longer lands live on publish; it waits for the request to merge. Nothing merges without your review.',
}

type PendingResolve = (target: PublishTarget | null) => void
type Handler = (req: PublishTargetRequest) => Promise<PublishTarget | null>

let activeHandler: Handler | null = null
/** The last destination the human confirmed — prefills the next ask (session-lived). */
let lastConfirmed: PublishTarget | null = null

/** Ask the human for the publish destination. Resolves null on cancel (the publish is
 * denied). With no mounted host, resolves the prefills immediately (headless-safe). */
export const requestPublishTarget = async (req: PublishTargetRequest): Promise<PublishTarget | null> => {
  if (!activeHandler) {
    return { base: req.base, owner: req.owner, repo: req.repo }
  }

  return activeHandler(req)
}

/** Coerce a publish fence's coords into prefills and ask the human for the destination
 * (one-liner for the provider's publish branches; null = cancelled → deny the publish). The
 * owner default is per-builder (`defaultOwner`) because the builders live in different orgs —
 * blueprints in krateo-blueprints, pages + the KOG/oas registry in krateo-platformops. It stays
 * optional (defaulting to krateo-blueprints) so callers/tests that don't pass it are unchanged. */
export const askPublishDestination = (
  proposal: { base?: string; owner?: string; repo?: string },
  kind: PublishTargetRequest['kind'],
  defaultRepo: string,
  defaultOwner = 'krateo-blueprints',
): Promise<PublishTarget | null> => requestPublishTarget({
  base: typeof proposal.base === 'string' && proposal.base ? proposal.base : 'main',
  kind,
  owner: typeof proposal.owner === 'string' && proposal.owner ? proposal.owner : defaultOwner,
  repo: typeof proposal.repo === 'string' && proposal.repo ? proposal.repo : defaultRepo,
})

/** TEST SEAM — reset the module-level state between specs. */
export const resetPublishTargetForTests = (): void => {
  activeHandler = null
  lastConfirmed = null
}

export const PublishTargetFormHost = () => {
  const [form] = Form.useForm<PublishTarget>()
  const [pending, setPending] = useState<{ req: PublishTargetRequest; resolve: PendingResolve } | null>(null)

  useEffect(() => {
    activeHandler = (req) => new Promise((resolve) => {
      setPending({ req, resolve })
    })

    return () => {
      activeHandler = null
    }
  }, [])

  useEffect(() => {
    if (pending) {
      form.setFieldsValue(lastConfirmed ?? { base: pending.req.base, owner: pending.req.owner, repo: pending.req.repo })
    }
  }, [pending, form])

  const close = (target: PublishTarget | null) => {
    if (target) {
      lastConfirmed = target
    }
    pending?.resolve(target)
    setPending(null)
  }

  return (
    <Modal
      cancelText='Cancel publish'
      okText='Confirm destination'
      onCancel={() => close(null)}
      onOk={() => {
        void form.validateFields().then((values) => close(values)).catch(() => { /* invalid — stay open */ })
      }}
      open={pending !== null}
      title={`Where should this ${pending ? KIND_NOUN[pending.req.kind] : 'page'} be committed?`}
    >
      <div data-testid='publish-target-form'>
        <Typography.Paragraph type='secondary'>
          {/* Name the artifact at the write gate: what a publish of THIS kind actually commits. */}
          {pending ? KIND_BLURB[pending.req.kind] : KIND_BLURB.page}
        </Typography.Paragraph>
        <Form form={form} layout='vertical'>
          <Form.Item label='Repository owner' name='owner' rules={[{ message: 'the owner/org (or GitLab group) is required', required: true }]}>
            <Input placeholder='krateo-blueprints' />
          </Form.Item>
          <Form.Item label='Repository' name='repo' rules={[{ message: 'the repository is required', required: true }]}>
            <Input placeholder='krateo-portal-chart' />
          </Form.Item>
          <Form.Item label='Base branch (the change-request target)' name='base' rules={[{ message: 'the base branch is required', required: true }]}>
            <Input placeholder='main' />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  )
}

export default PublishTargetFormHost
