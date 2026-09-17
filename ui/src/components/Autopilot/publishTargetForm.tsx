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

import { ABOVE_PREVIEW_DRAWER_Z_INDEX } from '../../hooks/confirmModalProps'

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
/**
 * The last destination the human confirmed, PER KIND — prefills the next ask of that same
 * kind (session-lived).
 *
 * Keyed by kind, not global. A single memo made one confirmed destination prefill every
 * later publish of every kind, so confirming a KOG mapping into krateo-oas left the next
 * PAGE publish pointing at the KOG registry — while the preview chip beside the form still
 * read "Publishes to krateo-portal-chart". A tester's screenshot showed exactly that pair.
 * The artifacts live in different repos by design (blueprints in krateo-blueprints, pages
 * in the portal chart, KOG mappings in krateo-oas), so carrying one kind's answer over to
 * another is never the helpful default — it is a mis-publish with a plausible-looking
 * prefill. Within a kind, repeating the last answer is genuinely useful, so that stays.
 */
let lastConfirmed: Partial<Record<PublishTargetRequest['kind'], PublishTarget>> = {}

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
  lastConfirmed = {}
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
      form.setFieldsValue(lastConfirmed[pending.req.kind] ?? { base: pending.req.base, owner: pending.req.owner, repo: pending.req.repo })
    }
  }, [pending, form])

  const close = (target: PublishTarget | null) => {
    if (target && pending) {
      lastConfirmed[pending.req.kind] = target
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
      // ABOVE THE PREVIEW DRAWER. This form is opened BY a publish the user started from
      // the preview, so the drawer is always up behind it. In antd 6 both surfaces default
      // to `token.zIndexPopupBase` (1000) and the drawer pins itself there explicitly, so a
      // tie is decided by DOM order — and the always-mounted drawer wins, clipping this
      // form and putting "Confirm destination" somewhere the user can neither see nor
      // click. The blast-radius confirm was raised for exactly this reason; this second
      // gate on the same flow was missed until a tester hit it.
      zIndex={ABOVE_PREVIEW_DRAWER_Z_INDEX}
    >
      <div data-testid='publish-target-form'>
        <Typography.Paragraph type='secondary'>
          {/* Name the artifact at the write gate: what a publish of THIS kind actually commits. */}
          {pending ? KIND_BLURB[pending.req.kind] : KIND_BLURB.page}
        </Typography.Paragraph>
        <Typography.Paragraph data-testid='publish-repo-precondition' type='secondary'>
          {/* THIS TEXT WAS WRONG AND SENT PEOPLE TO DO WORK THE PLATFORM ALREADY DOES. It used to say
              the repository "must already exist ... it does not create the repository", dating from
              when the publish only cloned a destination. builder-publish now renders a github
              `Repository` (values.yaml `repository.create: true`, `autoInit: true`) and creates it,
              which is why a brand-new page set no longer needs a repo made by hand first. Verified on
              krateo-057: a publish to krateo-blueprints/demo-destination rendered
              `publish-team-health-repo` with `auto_init: true`.

              It also contradicted the compose-page form one panel away, whose own field help reads
              "Created automatically if it does not exist yet." Two opposite claims about the same
              action in the same product is worse than either one alone. */}
          The repository is <strong>created if it doesn&rsquo;t exist</strong>. Publishing pushes a
          branch to it and opens a change request into the base branch below — nothing merges without
          your review.
        </Typography.Paragraph>
        <Form form={form} layout='vertical'>
          <Form.Item label='Repository owner' name='owner' rules={[{ message: 'the owner/org (or GitLab group) is required', required: true }]}>
            <Input placeholder='krateo-blueprints' />
          </Form.Item>
          <Form.Item label='Repository' name='repo' rules={[{ message: 'the repository is required', required: true }]}>
            <Input placeholder='portal' />
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
