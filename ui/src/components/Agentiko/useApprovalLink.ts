/**
 * The `?agentiko=<contextId>` approval link, wired (approvalLink.ts has the reads and the words).
 *
 * Consumed like `?ask=` (askDeepLink.ts): once per navigation that carries it, then stripped from the
 * address (replace, not push), so a refresh does not reopen it; held while availability is
 * `checking`; when the agent is locked or unreachable the rail opens and says why. Unlike `?ask=`
 * nothing is SENT on open: the link shows a decision that is already waiting.
 *
 * Opening reads the session and its input-required task as this user, starts a fresh thread (the
 * outgoing one is archived, as for `?ask=`) bound to that session, so a later turn continues it, and
 * shows the approval on a short note saying where it came from. The pause is EXPLICIT ONLY (Diego):
 * createExplicitApprovalGovernor has no timer, and the provider's thread teardown leaves an
 * `origin: 'link'` pause paused instead of denying it.
 */
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { useLocation, useSearchParams } from 'react-router'

import { randomId } from '../../utils/utils'

import { createExplicitApprovalGovernor, type ApprovalGovernor, type ApprovalPause } from './approval'
import { APPROVAL_LINK_PARAM, LINKED_APPROVAL_NOTE, linkedApprovalNotice, loadLinkedApproval, railNamespaceOf } from './approvalLink'
import type { AskAccess } from './availability'
import { agentikoConversationStore } from './conversationStore'
import { deriveSessionsBase } from './evidence'
import { a2aAuthHeader } from './transport'
import type { AgentikoMessage } from './types'

export interface ApprovalLinkWiring {
  access: AskAccess
  agent: string
  approvalRef: MutableRefObject<{ governor: ApprovalGovernor; pause: ApprovalPause } | null>
  endpoint: string | undefined
  newThread: () => void
  setMessages: Dispatch<SetStateAction<AgentikoMessage[]>>
  setOpen: (open: boolean) => void
  setPendingApproval: (pause: ApprovalPause | null) => void
}

export const useApprovalLink = ({ access, agent, approvalRef, endpoint, newThread, setMessages, setOpen, setPendingApproval }: ApprovalLinkWiring): void => {
  const [searchParams, setSearchParams] = useSearchParams()
  const { key } = useLocation()
  const handledKeyRef = useRef<string | null>(null)

  const open = useCallback(async (contextId: string) => {
    setOpen(true)
    const result = endpoint && endpoint !== 'echo'
      ? await loadLinkedApproval(deriveSessionsBase(endpoint), contextId, { agent, namespace: railNamespaceOf(endpoint) }, a2aAuthHeader())
      : { kind: 'error' as const }
    newThread()
    const now = Date.now()
    if (result.kind !== 'paused') {
      setMessages((prev) => [...prev, { createdAt: now, id: randomId(), role: 'assistant', text: linkedApprovalNotice(result) }])
      return
    }
    agentikoConversationStore.setContextId(contextId, agent)
    const pause: ApprovalPause = { ...result.pause, origin: 'link' }
    setMessages((prev) => [...prev, { approvalAt: now, createdAt: now, id: randomId(), role: 'assistant', text: LINKED_APPROVAL_NOTE }])
    approvalRef.current = { governor: createExplicitApprovalGovernor(), pause }
    setPendingApproval(pause)
  }, [agent, approvalRef, endpoint, newThread, setMessages, setOpen, setPendingApproval])

  useEffect(() => {
    const contextId = searchParams.get(APPROVAL_LINK_PARAM)?.trim()
    if (!contextId || access === 'checking') { return }
    if (handledKeyRef.current !== key) {
      handledKeyRef.current = key
      if (access === 'ready') {
        void open(contextId)
      } else {
        setOpen(true)
      }
    }
    const next = new URLSearchParams(searchParams)
    next.delete(APPROVAL_LINK_PARAM)
    setSearchParams(next, { replace: true })
  }, [access, key, open, searchParams, setOpen, setSearchParams])
}
