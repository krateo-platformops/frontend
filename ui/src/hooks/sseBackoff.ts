/**
 * The ONE reconnect-backoff policy for every fetch-SSE stream in the portal.
 *
 * `refreshSse` had it first and paid for it: a fleet of tabs that lost the stream together —
 * a snowplow rollout, a gateway blip, an sse-proxy roll — retries in lockstep without jitter,
 * turning one outage into a synchronised herd on every subsequent attempt (its design §10
 * decision 4). It lives here so `sseClient` cannot acquire a SECOND policy that drifts from
 * it: two backoff curves in one tab are indistinguishable from a bug when they interleave.
 *
 * What the numbers are NOT for: an authentication failure. A 401 re-presented on a timer is
 * the defect that produced 553 gateway rejections in one window — it backs off to the ceiling
 * and stays there, with no path back to a live stream. Auth failures raise session-resume;
 * only a transport fault or a server close earns a retry.
 */
const RECONNECT_BACKOFF_BASE_MS = 1000
const RECONNECT_BACKOFF_MAX_MS = 30000
/** ±25 % spread, applied to the capped base. */
const RECONNECT_BACKOFF_JITTER = 0.25

/**
 * How long to wait before reconnect attempt `attempt` (0-based): capped exponential, jittered.
 *
 * Unbounded on purpose — a push channel whose server is down for ten minutes must still be
 * live on minute eleven, and at the 30 s ceiling that costs two requests a minute per tab.
 * The budget that matters is the one the CALLER resets on a successful open, so an endpoint
 * that drops once an hour never creeps up the curve.
 */
export const reconnectDelayMs = (attempt: number): number => {
  const base = Math.min(RECONNECT_BACKOFF_BASE_MS * 2 ** attempt, RECONNECT_BACKOFF_MAX_MS)
  return Math.round(base * (1 - RECONNECT_BACKOFF_JITTER + Math.random() * 2 * RECONNECT_BACKOFF_JITTER))
}

/** The un-jittered curve, for tests and for asserting the ceiling. */
export const reconnectBaseMs = (attempt: number): number =>
  Math.min(RECONNECT_BACKOFF_BASE_MS * 2 ** attempt, RECONNECT_BACKOFF_MAX_MS)

/** The jitter spread, so a test can bound a delay without restating the constant. */
export const RECONNECT_JITTER_SPREAD = RECONNECT_BACKOFF_JITTER
