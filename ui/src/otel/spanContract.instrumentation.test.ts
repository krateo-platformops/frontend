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
import { describe, expect, it, vi } from 'vitest'

import { ContractSpanProcessor, SPAN_NAMES } from './spanContract'

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
    expect(attributes['http.request.method']).toBe('POST')
  })
})

describe('ContractSpanProcessor renames a REAL instrumentation span', () => {
  it('renames it to krateo.widget.fetch and EXPORTS it', () => {
    const captured = spanAsInstrumented('GET')
    const { onEnd, processor } = harness()
    const span = startableFrom(captured)

    processor.onStart(span as never, {} as never)
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)

    processor.onEnd({ attributes: captured.attributes, name: span.name } as never)
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
