/**
 * "Start a page" — the two questions a new draft cannot be created without.
 *
 * DELIBERATELY TWO. `form.compose-page` asks for a slug AND the whole git destination up front,
 * which front-loads a decision (which repo, which branch) that belongs at PUBLISH, long after the
 * author knows whether the page is worth publishing at all. The target picker already exists and
 * already runs at publish time; asking here would be a second place that has to agree with it.
 *
 * The title is optional because a sensible one is derivable from the slug, and an author who does
 * not care should not be made to type it twice.
 */
import { Alert, Form, Input, Modal, Typography } from 'antd'
import { useState } from 'react'

import { SLUG_PATTERN, startDraft, validateStartDraft } from './startDraft'
import type { StartDraftResult } from './startDraft'

export const StartDraftModal = ({ namespace, onCancel, onStart, open }: {
  /** Namespace the seeded CRs are created in — the widget CRDs require one and default it nowhere. */
  namespace: string
  onCancel: () => void
  onStart: (result: Extract<StartDraftResult, { ok: true }>) => void
  open: boolean
}) => {
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const input = { namespace, slug, title }
    const invalid = validateStartDraft(input)
    if (invalid) {
      setError(invalid)
      return
    }
    const result = startDraft(input)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onStart(result)
  }

  return (
    <Modal okText='Start' onCancel={onCancel} onOk={submit} open={open} title='Start a page' width={560}>
      <Typography.Paragraph type='secondary'>
        Creates an empty draft — a root layout and a page header. Nothing is written to the cluster
        and nothing is published until you say so.
      </Typography.Paragraph>
      <Form layout='vertical'>
        <Form.Item
          help={`The page becomes /<slug> and the CR page-<slug>. Lower-case, dashes.`}
          label='Page slug'
          required
        >
          <Input
            onChange={(event) => setSlug(event.target.value)}
            onPressEnter={submit}
            placeholder='fleet-health'
            status={slug && !SLUG_PATTERN.test(slug) ? 'error' : undefined}
            value={slug}
          />
        </Form.Item>
        <Form.Item help='Shown in the page header. Defaults to the slug, title-cased.' label='Title'>
          <Input
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={submit}
            placeholder='Fleet health'
            value={title}
          />
        </Form.Item>
        {error ? <Alert showIcon title={error} type='error' /> : null}
      </Form>
    </Modal>
  )
}

export default StartDraftModal
