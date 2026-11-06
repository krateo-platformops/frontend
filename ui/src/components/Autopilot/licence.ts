/**
 * Whether the agent is LICENSED on this install — distinct from `reachable` (usable right now).
 *
 * Agentiko is the licensed part of the portal. The licence is the installer's existing switch:
 * an agent endpoint is configured AND `AUTOPILOT_AVAILABLE` is not `"false"` (the installer sets
 * it when agents are not deployed or not licensed). Without a licence the agent stays VISIBLE but
 * locked — the header toggle shows a lock and opens the rail on an "Activate licence" panel, and
 * every `intent: autopilot` button is drawn locked — so the capability is discoverable.
 *
 * Its own module, not AutopilotProvider: the Button widget reads it, renders in tests without a
 * provider, and four test files stub AutopilotProvider wholesale (see copy.ts) — a hook exported
 * from a stubbed module arrives `undefined`. Outside a provider the agent counts as licensed, so a
 * widget rendered on its own keeps its full look.
 */
import { createContext, useContext } from 'react'

export const AutopilotLicenceContext = createContext<boolean | null>(null)

export const useAgentikoLicensed = (): boolean => useContext(AutopilotLicenceContext) ?? true

/** Where "Activate licence" leads. */
export const AGENTIKO_LICENCE_URL = 'https://agentiko.eu/'
