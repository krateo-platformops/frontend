/**
 * Which family a status pill's Kubernetes token belongs to, and so which glyph it carries
 * (portal UX review, approved mockup https://claude.ai/artifact/9hhSkvWweGMKBTWckPPjQb).
 *
 * The family comes from the TOKEN, never the colour: Paused and ReadyUnknown are both grey, but one
 * is a choice someone made and the other is "nothing concluded yet". The tokens are the K8s-native
 * vocabulary the portal's pills print (ready-reasons.yaml / cd-ready-reasons.yaml in portal).
 *
 * Anything else returns `undefined` and the pill keeps its dot: domain states that are not a
 * Kubernetes resource state (a pull request's Open/Merged, an alert's Firing, a chart's maturity),
 * pod reasons passed through verbatim (CrashLoopBackOff), and the bare condition statuses
 * True / False / Unknown, which are not a verdict on their own (Synced=False is expected while
 * Paused). An unrecognised token never gets a wrong glyph.
 */
export type StateFamily = 'drift' | 'failed' | 'healthy' | 'paused' | 'transitional' | 'unknown'

const FAMILY: Record<string, StateFamily> = {
  Creating: 'transitional',
  Degraded: 'failed',
  Deleting: 'transitional',
  Drift: 'drift',
  Failed: 'failed',
  Healthy: 'healthy',
  NotReady: 'failed',
  NotSynced: 'drift',
  Paused: 'paused',
  Pending: 'transitional',
  Progressing: 'transitional',
  Ready: 'healthy',
  ScaledToZero: 'healthy',
  Synced: 'healthy',
  Unhealthy: 'failed',
}

/** A composed unknown, `<Type>Unknown` (ReadyUnknown, SyncedUnknown): not the bare status `Unknown`. */
const COMPOSED_UNKNOWN = /^[A-Z][A-Za-z]+Unknown$/

export const stateFamily = (label: unknown): StateFamily | undefined => {
  if (typeof label !== 'string') { return undefined }
  const token = label.trim()
  if (Object.prototype.hasOwnProperty.call(FAMILY, token)) { return FAMILY[token] }
  return COMPOSED_UNKNOWN.test(token) ? 'unknown' : undefined
}
