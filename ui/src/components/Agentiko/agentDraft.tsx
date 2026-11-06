/**
 * AgentDraft channel (Phase 3, gated form-fill). A tiny context the Form widget
 * reads to merge an Agentiko-proposed draft as a THIRD spread into its
 * `initialValues` — Agentiko fills the fields, the human reviews and submits via
 * the form's OWN gate (`reviewBeforeSubmit` → Create). Agentiko never submits, so
 * the actual mutation is always human-gated.
 *
 * Deliberately standalone (not the Agentiko context) with a safe default, so the
 * Form widget works identically whether or not Agentiko is mounted.
 */

import { createContext, useContext } from 'react'

export interface AgentDraftValue {
  /** Field values to merge into the mounted Form's initialValues (null = none). */
  draft: Record<string, unknown> | null
  /** Bumped on each new draft so the Form re-keys and re-applies initialValues
   * (antd `initialValues` is mount-only). */
  nonce: number
}

const AgentDraftContext = createContext<AgentDraftValue>({ draft: null, nonce: 0 })

export const AgentDraftProvider = AgentDraftContext.Provider

/** Read the current Agentiko form draft. Safe default (no draft) when unprovided. */
export const useAgentDraft = (): AgentDraftValue => useContext(AgentDraftContext)
