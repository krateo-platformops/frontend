/**
 * The composer's side of Resume (screens 3 and 4 of the draft-records mockup), shared by both
 * composers: read `?resume=` (or, on the page composer, `?adopt=`) once on mount, read the record as
 * the person, ask the provider to hold it, and show what happened.
 *
 * WHY A HOOK THAT RETURNS AN ELEMENT, not a component. A composer renders a different tree for "no
 * draft" and "a draft is held", and a resume STARTS in the first and ENDS in the second. A component
 * placed in both would remount across that switch and forget the answer it was waiting for; state
 * held at the page, with its element placed in each branch, does not.
 *
 * THE LINK IS CONSUMED. The parameter is taken off the address as soon as it is read, so a reload
 * or a Back does not ask to resume the same draft over the edits made since — those are in the
 * record now (the autosave), and Your drafts is where to resume them from.
 */
import { Alert, App, Descriptions, Modal, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import { countNoun } from '../../utils/utils'

import { adoptRootFrom, ADOPT_PARAM, DISCARD_LEGACY_PARAM, readLegacyPageSet, type SandboxTarget } from './adoptLegacyPage'
import type { DraftKind } from './blueprintDraftStore'
import { treeHash, type DraftRecordBody } from './draftRecord'
import { readDraftRecordByName, readiness, restoredBannerCopy, RESUME_PARAM, resumeRecordNameFrom, savedWhen, wrongComposerMessage } from './draftResume'
import { emitDraftResume, emitLegacyDiscard, onDraftResumeResult, onLegacyDiscardResult } from './previewDraftResume'

type Notice =
  | { type: 'reading'; text: string }
  | { type: 'error'; text: string }
  | { type: 'restored'; title: string; body: string; warning?: string }

interface Asking {
  held: { kind: DraftKind; name: string; previewed: boolean }
  record: DraftRecordBody
  retire?: SandboxTarget[]
}

export interface DraftResumeOptions {
  /** Which composer this is: a record of the other kind is not loaded here, and says where to go. */
  kind: DraftKind
  snowplowBaseUrl?: string
  sandboxNamespace?: string
  /**
   * The page composer only: `?adopt=<root flex name>` adopts a legacy page set, and
   * `?discard-legacy=<root flex name>` deletes one (Unowned drafts' Discard) and returns to the list.
   */
  allowAdopt?: boolean
  /** The draft now held is the resumed one — drop anything this page kept about the one before. */
  onResumed?: () => void
}

/** Take the link's parameters off the address without a navigation (see the header). */
const consumeParams = (): void => {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete(RESUME_PARAM)
    url.searchParams.delete(ADOPT_PARAM)
    url.searchParams.delete(DISCARD_LEGACY_PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // An address that cannot be rewritten only means a reload asks again — never worth a crash.
  }
}

/**
 * Back to the Portal Builder's list, as a client-side navigation: a full load would drop whatever
 * draft this tab holds. The router follows the history it is told about through `popstate`, which is
 * how this hook can go there without a router context of its own (the composer mounts bare in tests).
 */
export const returnToPortalBuilder = (): void => {
  window.history.pushState(null, '', '/portal-builder')
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
}

const newId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useDraftResume = ({ allowAdopt, kind, onResumed, sandboxNamespace, snowplowBaseUrl }: DraftResumeOptions) => {
  const [notice, setNotice] = useState<Notice | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  /** The request in flight, by id — the answer to anyone else's is not ours. */
  const pending = useRef<{ id: string; record: DraftRecordBody; retire?: SandboxTarget[]; adopted: boolean } | null>(null)
  const onResumedRef = useRef(onResumed)
  onResumedRef.current = onResumed
  // Once per mount, and StrictMode runs a mount effect twice: the second read would be a second
  // resume of the same record, answered `held` by the first.
  const started = useRef(false)
  const discardId = useRef<string | null>(null)
  // Outside an antd <App> this is an empty default with no methods — hence the optional calls below.
  const { message } = App.useApp()

  // The legacy Discard's outcome: deleted or declined → said, and back to the list the person came
  // from; a failure stays here, where the objects still in the sandbox are named.
  useEffect(() => onLegacyDiscardResult((result) => {
    if (discardId.current !== result.id) {
      return
    }
    discardId.current = null
    if (result.outcome === 'failed') {
      setNotice({ text: result.message, type: 'error' })
      return
    }
    setNotice(null)
    if (result.outcome === 'deleted') {
      message?.success?.(result.message)
    } else {
      message?.info?.(result.message)
    }
    returnToPortalBuilder()
  }), [message])

  const request = useCallback((record: DraftRecordBody, replace: boolean, adopted: boolean, retire?: SandboxTarget[]) => {
    const id = newId()
    pending.current = { adopted, id, record, ...(retire ? { retire } : {}) }
    emitDraftResume({ id, record, ...(replace ? { replace } : {}), ...(retire ? { retire } : {}) })
  }, [])

  useEffect(() => onDraftResumeResult((result) => {
    const asked = pending.current
    if (!asked || asked.id !== result.id) {
      return
    }
    if (result.outcome === 'held') {
      setNotice(null)
      setAsking({ held: result.held, record: asked.record, ...(asked.retire ? { retire: asked.retire } : {}) })
      return
    }
    pending.current = null
    if (result.outcome === 'refused') {
      setNotice({ text: result.message, type: 'error' })
      return
    }
    const copy = restoredBannerCopy({
      everPreviewed: asked.record.renderedHash !== undefined,
      kind: asked.record.kind,
      previewed: result.previewed,
      relinked: result.relinked,
      updatedAt: asked.record.updatedAt,
    })
    setNotice({
      body: copy.body,
      title: asked.adopted ? `Adopted ${asked.record.name} into your drafts — last changed ${savedWhen(asked.record.updatedAt)}.` : copy.title,
      type: 'restored',
      ...(result.retireError || result.updated ? { warning: [result.updated, result.retireError].filter(Boolean).join(' ') } : {}),
    })
    onResumedRef.current?.()
  }), [])

  useEffect(() => {
    if (started.current) {
      return
    }
    started.current = true
    const { search } = window.location
    const recordName = resumeRecordNameFrom(search)
    const adoptRoot = allowAdopt && !recordName ? adoptRootFrom(search) : null
    const discardRoot = allowAdopt && !recordName && !adoptRoot ? adoptRootFrom(search, DISCARD_LEGACY_PARAM) : null
    if (!recordName && !adoptRoot && !discardRoot) {
      return
    }
    consumeParams()
    void (async () => {
      if (discardRoot) {
        // The same walk as Adopt, so the confirm lists the WHOLE set — not the root alone, which is
        // all a list row could delete, orphaning the rest.
        setNotice({ text: `Reading ${discardRoot} from the sandbox…`, type: 'reading' })
        const read = await readLegacyPageSet(snowplowBaseUrl, sandboxNamespace, discardRoot, 'discard')
        if (!read.ok) {
          setNotice({ text: read.message, type: 'error' })
          return
        }
        setNotice({ text: `Confirm to delete ${discardRoot} and the ${countNoun(read.retire.length, 'object')} it holds…`, type: 'reading' })
        discardId.current = newId()
        emitLegacyDiscard({ id: discardId.current, root: discardRoot, targets: read.retire })
        return
      }
      if (recordName) {
        setNotice({ text: `Reading ${recordName} from your drafts…`, type: 'reading' })
        const read = await readDraftRecordByName(snowplowBaseUrl, sandboxNamespace, recordName)
        if (!read.ok) {
          setNotice({ text: read.message, type: 'error' })
          return
        }
        if (read.record.kind !== kind) {
          setNotice({ text: wrongComposerMessage(read.record), type: 'error' })
          return
        }
        request(read.record, false, false)
        return
      }
      setNotice({ text: `Reading ${adoptRoot} from the sandbox…`, type: 'reading' })
      const read = await readLegacyPageSet(snowplowBaseUrl, sandboxNamespace, adoptRoot as string)
      if (!read.ok) {
        setNotice({ text: read.message, type: 'error' })
        return
      }
      request(read.record, false, true, read.retire)
    })()
    // The link is read once, at mount, with the config the page mounted with — see `started`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cancel = useCallback(() => {
    pending.current = null
    setAsking(null)
  }, [])

  const confirm = useCallback(() => {
    const current = asking
    setAsking(null)
    if (current) {
      request(current.record, true, !!current.retire, current.retire)
    }
  }, [asking, request])

  const resuming = asking
    ? asking.record.renderedHash !== undefined && asking.record.renderedHash === treeHash(asking.record.files)
    : false

  // Screen 4. antd's Modal: focus is trapped and Escape is Cancel, which is the safe answer.
  const prompt = (
    <Modal
      cancelText='Cancel'
      okText='Close and resume'
      onCancel={cancel}
      onOk={confirm}
      open={!!asking}
      title={asking ? `Close ${asking.held.name} to resume ${asking.record.name}?` : undefined}
    >
      {asking ? (
        <>
          <Typography.Paragraph>
            You can have one draft open at a time. {asking.held.name} is saved in Your drafts, so closing it loses
            nothing, and you can resume it later.
          </Typography.Paragraph>
          <Descriptions
            column={1}
            items={[
              { children: `${asking.held.name} · ${readiness(asking.held.previewed)}`, key: 'open', label: 'Open now' },
              { children: `${asking.record.name} · ${readiness(resuming)}`, key: 'resuming', label: 'Resuming' },
            ]}
            size='small'
          />
        </>
      ) : null}
    </Modal>
  )

  let banner: React.ReactNode = null
  if (notice?.type === 'reading') {
    banner = <Alert showIcon title={notice.text} type='info' />
  } else if (notice?.type === 'error') {
    banner = <Alert closable onClose={() => setNotice(null)} showIcon title={notice.text} type='warning' />
  } else if (notice?.type === 'restored') {
    banner = (
      <>
        {/* role='status': it reports what just happened to the page, without interrupting. */}
        <Alert closable description={notice.body} onClose={() => setNotice(null)} role='status' showIcon title={notice.title} type='info' />
        {notice.warning ? <Alert showIcon title={notice.warning} type='warning' /> : null}
      </>
    )
  }

  return <>{banner}{prompt}</>
}
