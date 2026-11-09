/**
 * The claim check, made COUNTABLE.
 *
 * Each unbacked claim is stamped on its assistant message (the durable transcript record, which
 * survives a remount, a thread switch and the history archive) and is ALSO emitted as one OTel span,
 * `krateo.agentiko.claim.unbacked`, through the portal's browser tracer. `otel/tracing.ts` registers
 * that tracer only when a traces endpoint is configured (`OTEL_TRACES_ENDPOINT || OTEL_COLLECTOR_URL`,
 * `otel/endpoint.ts`); without one `@opentelemetry/api` hands back a no-op tracer, so this costs
 * nothing on an install that does not collect traces.
 *
 * THE NAME AND THE TWO ATTRIBUTES ARE A CONTRACT WITH SNOWPLOW, which forwards a browser span only
 * when its allowlist names it. `ContractSpanProcessor` exports this name (`COUNTED_SPAN_NAMES` in
 * `otel/spanContract.ts`); until snowplow's allowlist carries it, the ingest drops it, per span.
 * Once forwarded, "how often does Agentiko claim what it did not do, per family, per outcome" is:
 *   SpanName = 'krateo.agentiko.claim.unbacked'
 *   GROUP BY SpanAttributes['krateo.agentiko.claim.family'], SpanAttributes['krateo.agentiko.claim.outcome']
 *
 * snowplow forwards an attribute value only if it matches `^[a-z][a-z0-9_]{0,31}$`, and drops it
 * otherwise. Every family and outcome is checked against that pattern in claimTelemetry.test.ts.
 *
 * NOTHING ELSE IS AN ATTRIBUTE.
 *  - Not the phrase: it is model output about the person's resources, and a trace is the wrong place
 *    for it.
 *  - Not the session or conversation id: no identity on spans, plain or hashed (snowplow#848), and a
 *    conversation id leads to a person through the conversation store. Finding the thread behind a
 *    count is a lookup in Agentiko's own store, not a trace attribute.
 */
import { trace } from '@opentelemetry/api'

import { COUNTED_SPAN_NAMES } from '../../otel/spanContract'

import type { UnbackedClaim } from './claimCheck'

export const CLAIM_SPAN = COUNTED_SPAN_NAMES.agentikoClaimUnbacked
export const CLAIM_TRACER = 'krateo-agentiko'
export const ATTR_CLAIM_FAMILY = 'krateo.agentiko.claim.family'
export const ATTR_CLAIM_OUTCOME = 'krateo.agentiko.claim.outcome'

export const recordUnbackedClaims = (claims: readonly UnbackedClaim[]): void => {
  const tracer = trace.getTracer(CLAIM_TRACER)
  for (const claim of claims) {
    tracer.startSpan(CLAIM_SPAN, {
      attributes: {
        [ATTR_CLAIM_FAMILY]: claim.family,
        [ATTR_CLAIM_OUTCOME]: claim.outcome,
      },
    }).end()
  }
}
