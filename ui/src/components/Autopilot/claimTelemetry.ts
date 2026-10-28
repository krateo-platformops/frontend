/**
 * The claim check, made COUNTABLE.
 *
 * Each unbacked claim is stamped on its assistant message (the durable transcript record, which
 * survives a remount, a thread switch and the history archive) and is ALSO emitted as one OTel span,
 * `autopilot.claim.unbacked`, through the portal's browser tracer. `otel/tracing.ts` registers that
 * tracer only when `OTEL_COLLECTOR_URL` is configured; without it `@opentelemetry/api` hands back a
 * no-op tracer, so this costs nothing on an install that does not collect traces.
 *
 * With a collector, the spans land beside every other `krateo-frontend` span, so "how often does
 * Autopilot claim what it did not do, per family, per outcome" is one query:
 *   SpanName = 'autopilot.claim.unbacked' GROUP BY SpanAttributes['autopilot.claim.family'], …['autopilot.claim.outcome']
 *
 * The phrase is NOT an attribute: it is model output about the person's resources, and a trace is
 * the wrong place for it. Family + outcome + session are enough to count and to find the thread.
 */
import { trace } from '@opentelemetry/api'

import type { UnbackedClaim } from './claimCheck'

export const CLAIM_SPAN = 'autopilot.claim.unbacked'

export const recordUnbackedClaims = (claims: readonly UnbackedClaim[], sessionId: string): void => {
  const tracer = trace.getTracer('krateo-autopilot')
  for (const claim of claims) {
    tracer.startSpan(CLAIM_SPAN, {
      attributes: {
        'autopilot.claim.family': claim.family,
        'autopilot.claim.outcome': claim.outcome,
        'autopilot.session.id': sessionId,
      },
    }).end()
  }
}
