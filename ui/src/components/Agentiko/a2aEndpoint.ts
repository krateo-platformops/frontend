/**
 * THE A2A ENDPOINT, and the agent it reaches — read from one value so the two cannot disagree.
 *
 * The rail talks to exactly one kagent agent: the one at the end of the configured
 * `AGENTIKO_API_BASE_URL` (read through `agentikoConfig`). The chart writes that value in one of
 * two forms, and the agent is the last path segment of both:
 *
 *   - agent gateway on:  `<gateway origin>/api/a2a/<release namespace>/<agentName>`
 *     (helm/frontend/templates/configmap.yaml appends the A2A path to the origin), so the last
 *     segment IS the agent name kagent routes on.
 *   - agent gateway off: `/<agentName>`, the same-origin nginx location named after the agent:
 *     `location /agentiko/` rewrites to `/api/a2a/krateo-system/agentiko/`, and `/autopilot/` to
 *     Agent `autopilot` (ui/nginx.conf; the vite dev proxy does the same).
 *     Here the last segment is the proxy location, and it names the agent because the location is
 *     named after the agent it fronts. a2aEndpoint.test.ts reads nginx.conf and vite.config.ts and
 *     fails if a location stops rewriting to the agent it is named after.
 *
 * WHY THE AGENT IDENTITY MATTERS: kagent looks a session up by `(contextId, user)` only, and refuses
 * a write to a session owned by another agent (403 "Session does not belong to this agent"). A
 * stored thread's `contextId` is therefore only valid against the agent that assigned it; see
 * conversationStore.ts `bindToAgent`.
 *
 * No imports, so the test files that replace `./transport` wholesale still get the real
 * derivation in the provider.
 */

/** The configured base with no trailing slash: the one normalisation both readers below share. */
const trimBase = (baseUrl: string): string => baseUrl.replace(/\/$/, '')

/** The URL a JSON-RPC call is POSTed to: the base with a trailing slash. */
export const a2aUrl = (baseUrl: string): string => `${trimBase(baseUrl)}/`

/** The agent a base reaches: its last path segment (`…/api/a2a/<ns>/autopilot` and `/autopilot` both give `autopilot`). */
export const agentOfA2aBase = (baseUrl: string): string => {
  const base = trimBase(baseUrl)
  return base.slice(base.lastIndexOf('/') + 1)
}
