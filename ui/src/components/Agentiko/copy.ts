/**
 * User-facing Agentiko copy that more than one component shows.
 *
 * Deliberately NOT in AgentikoProvider: four test files stub that module
 * (`vi.mock('./AgentikoProvider', …)`), and a constant exported from a stubbed module arrives as
 * `undefined` in every one of them — rendering an empty notice that no assertion would catch. A
 * plain module nobody needs to stub cannot fail that way, and the next test that mocks the
 * provider inherits the safety for free.
 */

/** Why Agentiko cannot be used right now: the header toggle's tooltip AND the rail's composer
 *  notice. One sentence, two consumers — two copies of user-facing text drift. */
export const AGENTIKO_UNAVAILABLE = 'Agentiko is unavailable — the agent is not deployed, not reachable, or not permitted for your user'
