// @vitest-environment jsdom
/**
 * The rename predicate against a span the REAL instrumentation names (#588).
 *
 * WHY THIS FILE EXISTS, SEPARATELY FROM spanContract.test.ts. That file constructs its spans by
 * hand, and for the auto-HTTP case it constructed `HTTP GET` — the name instrumentation-fetch used
 * at 0.219 and stopped using at 0.223, where `_createSpan` sets `const name = normMethod` (the bare
 * method). So the fixture and the predicate held the same wrong belief, and every control run
 * against them agreed with itself: breaking the predicate failed the tests exactly as designed,
 * which proved the tests were not vacuous and proved nothing about what the library emits.
 *
 * Meanwhile every fetch span was dropped in the browser — unrenamed at `onStart`, discarded at
 * `onEnd` for not being in ACCEPTED — with a 2xx on the wire and nothing arriving. acmp found it by
 * reading the 0.223.0 tarball and separately proving snowplow drops a span named `GET`.
 *
 * So this file takes its span name from the INSTALLED package rather than from a literal, which is
 * the only version of this test that could have caught it. If a future bump renames spans again,
 * this fails.
 */
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_URL_FULL } from '@opentelemetry/semantic-conventions'
import { describe, expect, it, vi } from 'vitest'

import { ContractSpanProcessor, SPAN_NAMES, URL_ATTRS } from './spanContract'

const PREFIX = 'https://portal.krateo.dev/content'

type Captured = { attributes: Record<string, unknown>; name: string }

/**
 * The name and attributes instrumentation-fetch ACTUALLY gives a span, from the installed build.
 *
 * `_createSpan` is internal, which is the point: it is where the name is decided, and the name is
 * this file's subject. A recording tracer captures what it is passed.
 */
const spanAsInstrumented = (method: string): Captured => {
  let captured: Captured | null = null
  const recordingSpan = {
    end: () => undefined,
    setAttribute: () => recordingSpan,
  }
  const tracer = {
    startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
      captured = { attributes: options?.attributes ?? {}, name }
      return recordingSpan
    },
  }

  const instrumentation = new FetchInstrumentation()
  // The PUBLIC seam: `tracer` is a getter sourced from the provider, so the provider is where a
  // recorder goes in.
  instrumentation.setTracerProvider({ getTracer: () => tracer } as never)
  const reachInternal = instrumentation as unknown as { _createSpan: (url: string, options: { method: string }) => void }
  reachInternal._createSpan(`${PREFIX}/x`, { method })

  if (captured === null) {
    throw new Error('the instrumentation created no span')
  }
  return captured
}

/** A mutable span as `onStart` receives it, carrying whatever the instrumentation really produced. */
const startableFrom = ({ attributes, name }: Captured) => {
  let current = name
  return {
    attributes,
    get name() { return current },
    updateName(next: string) { current = next; return this },
  }
}

const harness = () => {
  const onEnd = vi.fn()
  const inner = {
    // `Promise.resolve()` rather than `async () => undefined`: a SpanProcessor's flush and shutdown
    // return promises, and an async function with nothing to await only looks like it does work.
    forceFlush: () => Promise.resolve(),
    onEnd,
    onStart: () => undefined,
    shutdown: () => Promise.resolve(),
  }
  return { onEnd, processor: new ContractSpanProcessor(inner, PREFIX) }
}

describe('what instrumentation-fetch actually names its spans', () => {
  it('names the BARE method, not "HTTP <method>" — the change that broke the rename', () => {
    const { name } = spanAsInstrumented('GET')
    expect(name).toBe('GET')
    // The regression, pinned explicitly: the old predicate would not have matched this.
    expect(/^HTTP [A-Z]+$/.test(name)).toBe(false)
  })

  it('carries http.request.method, which is what the predicate now matches on', () => {
    const { attributes } = spanAsInstrumented('POST')
    expect(attributes[ATTR_HTTP_REQUEST_METHOD]).toBe('POST')
  })

  /**
   * The METHOD key was pinned here from the start; the URL key was not, and it is the same hazard
   * with a wider blast radius. `urlOf` walks `URL_ATTRS` and feeds `spanUnder`: if a bump moves
   * the URL to a key outside that list, `urlOf` returns null, `spanUnder` returns false, and
   * EVERY krateo.widget.fetch span is dropped before export — a green suite, a 2xx on the wire and
   * nothing arriving, which is #588's failure mode exactly.
   *
   * So the assertion is deliberately NOT `attributes['url.full'] === …`. It asks the question that
   * matters: whichever key the installed instrumentation chose, is it one this file READS?
   *
   * HONEST ABOUT WHAT THIS ADDS. The export path was ALREADY guarded here, indirectly: "renames it
   * to krateo.widget.fetch and EXPORTS it" below runs the real attributes through `spanUnder`,
   * so emptying the read-set fails it too (verified by doing exactly that). What it fails with is
   * `expected "vi.fn()" to be called once, but got 0 times` — true, and silent about the cause.
   * This test fails with the URL contract named, and pins which key, so the next bump costs a
   * reading of the diff rather than a reading of the 0.223 tarball. It is diagnostic precision on a
   * guard that existed, not a hole that did not.
   */
  it('records its URL under a key the contract READS — not merely under some key', () => {
    const { attributes } = spanAsInstrumented('GET')
    const readable = URL_ATTRS.filter((key) => attributes[key] === `${PREFIX}/x`)

    expect(readable).not.toHaveLength(0)
    // And WHICH key, pinned from the installed build: 0.223's `_createSpan` sets ATTR_URL_FULL.
    // NOT `http.url`, despite that being the older convention URL_ATTRS also carries and despite
    // the hand-built fixtures in spanContract.test.ts treating it as the primary. A failure on this
    // line alone is informative rather than urgent — the line above is the one that guards export.
    expect(readable).toEqual([ATTR_URL_FULL])
  })
})

describe('ContractSpanProcessor renames a REAL instrumentation span', () => {
  it('renames it to krateo.widget.fetch and EXPORTS it', () => {
    const captured = spanAsInstrumented('GET')
    const { onEnd, processor } = harness()
    const span = startableFrom(captured)

    processor.onStart(span as never, {} as never)
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)

    // Ended as a request that got its answer: the status code and the (empty) events and status every
    // ended span carries. An unanswered request is spanContract.fetch.test.ts's subject.
    const answered = { ...captured.attributes, [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200 }
    processor.onEnd({ attributes: answered, events: [], name: span.name, status: { code: 0 } } as never)
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('and WITHOUT the rename it would be dropped — the failure this guards', () => {
    const captured = spanAsInstrumented('GET')
    const { onEnd, processor } = harness()

    // Skip onStart: the span reaches onEnd still named `GET`, exactly as it did on 0.223 before the
    // fix. Nothing is exported, and nothing says so.
    processor.onEnd(captured as never)
    expect(onEnd).not.toHaveBeenCalled()
  })
})
