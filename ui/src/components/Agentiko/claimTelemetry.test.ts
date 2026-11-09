// @vitest-environment jsdom
/**
 * The unbacked-claim span, as the EXPORT side sees it: produced by `recordUnbackedClaims` through a
 * real `WebTracerProvider` and the real `ContractSpanProcessor`, captured by a recorder standing
 * where `BatchSpanProcessor` stands in `otel/tracing.ts`. A name the contract does not export never
 * reaches the recorder, so a pass here means the span would leave the browser.
 *
 * The values are checked against snowplow's attribute-value pattern from the SOURCE lists in
 * claimCheck.ts, not from a copy: a family or outcome added there later is checked here without
 * anyone remembering to.
 */
import { trace } from '@opentelemetry/api'
import { WebTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ContractSpanProcessor } from '../../otel/spanContract'

import { CLAIM_FAMILIES, CLAIM_RULES, UNBACKED_OUTCOMES, type UnbackedClaim } from './claimCheck'
import { ATTR_CLAIM_FAMILY, ATTR_CLAIM_OUTCOME, CLAIM_SPAN, CLAIM_TRACER, recordUnbackedClaims } from './claimTelemetry'

/** snowplow's rum-ingest drops an attribute whose value does not match this. */
const SNOWPLOW_VALUE = /^[a-z][a-z0-9_]{0,31}$/

let recorded: ReadableSpan[] = []

const recorder = (): SpanProcessor => ({
  forceFlush: () => Promise.resolve(),
  onEnd: (span) => { recorded.push(span) },
  onStart: () => undefined,
  shutdown: () => Promise.resolve(),
})

beforeEach(() => {
  recorded = []
  // The global provider is set once per process; `disable` first or a second `set` is ignored.
  trace.disable()
  trace.setGlobalTracerProvider(new WebTracerProvider({
    spanProcessors: [new ContractSpanProcessor(recorder(), 'https://portal.krateo.dev/content')],
  }))
})

afterEach(() => { trace.disable() })

const claim: UnbackedClaim = { family: 'preview', outcome: 'missing', phrase: 'I have authored and previewed' }

describe('the unbacked-claim span', () => {
  it('the recorder drops the old name, so a pass below is the contract processor exporting the new one', () => {
    trace.getTracer('probe').startSpan('autopilot.claim.unbacked').end()
    expect(recorded).toHaveLength(0)
  })

  it('is exported under the agreed name and tracer', () => {
    recordUnbackedClaims([claim])
    expect(recorded.map(({ name }) => name)).toEqual(['krateo.agentiko.claim.unbacked'])
    expect(CLAIM_SPAN).toBe('krateo.agentiko.claim.unbacked')
    expect(recorded[0].instrumentationScope.name).toBe('krateo-agentiko')
    expect(CLAIM_TRACER).toBe('krateo-agentiko')
  })

  it('carries exactly family and outcome: no session id, no phrase, nothing else', () => {
    recordUnbackedClaims([claim])
    expect(recorded[0].attributes).toEqual({
      'krateo.agentiko.claim.family': 'preview',
      'krateo.agentiko.claim.outcome': 'missing',
    })
    expect(ATTR_CLAIM_FAMILY).toBe('krateo.agentiko.claim.family')
    expect(ATTR_CLAIM_OUTCOME).toBe('krateo.agentiko.claim.outcome')
  })

  it('one span per claim', () => {
    recordUnbackedClaims([claim, { family: 'publish', outcome: 'refused', phrase: "I've published", reason: 'gated' }])
    expect(recorded.map(({ attributes }) => attributes[ATTR_CLAIM_FAMILY])).toEqual(['preview', 'publish'])
    expect(recorded[1].attributes).toEqual({ [ATTR_CLAIM_FAMILY]: 'publish', [ATTR_CLAIM_OUTCOME]: 'refused' })
  })
})

describe('every value the span can carry is one snowplow forwards', () => {
  it('the family list is the one the verb table uses', () => {
    expect(CLAIM_RULES.map(({ family }) => family).sort()).toEqual([...CLAIM_FAMILIES].sort())
  })

  it.each(CLAIM_FAMILIES)('family %s', (family) => {
    expect(family).toMatch(SNOWPLOW_VALUE)
  })

  it.each(UNBACKED_OUTCOMES)('outcome %s', (outcome) => {
    expect(outcome).toMatch(SNOWPLOW_VALUE)
  })

  it('and every one, emitted, arrives as that value', () => {
    for (const family of CLAIM_FAMILIES) {
      for (const outcome of UNBACKED_OUTCOMES) {
        recordUnbackedClaims([{ family, outcome, phrase: 'x' }])
      }
    }
    expect(recorded).toHaveLength(CLAIM_FAMILIES.length * UNBACKED_OUTCOMES.length)
    for (const { attributes } of recorded) {
      expect(String(attributes[ATTR_CLAIM_FAMILY])).toMatch(SNOWPLOW_VALUE)
      expect(String(attributes[ATTR_CLAIM_OUTCOME])).toMatch(SNOWPLOW_VALUE)
    }
  })
})
