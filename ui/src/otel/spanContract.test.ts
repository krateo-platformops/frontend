// @vitest-environment jsdom
/*
 * jsdom, because the processor resolves a span's URL against `window.location.origin` — it is
 * browser-only code. Without this directive the resolution throws, the catch returns false, and
 * the two tests that SHOULD export fail while every drop test passes: the failure looks like
 * over-aggressive dropping rather than a missing environment.
 */
/**
 * The span contract (X5). These tests exist because both failure modes here are INVISIBLE from the
 * browser: a span that should have been renamed is dropped server-side by snowplow#1015's
 * allowlist, and a span that should have been dropped costs ingestion budget a real one needed.
 * Either way the browser sees a 2xx and nothing arrives.
 */
import { describe, expect, it, vi } from 'vitest'

import { ATTR_ABANDONED, ATTR_ROUTE, ContractSpanProcessor, redactUrlAttributes, SPAN_NAMES } from './spanContract'

/**
 * A minimal mutable span, as `onStart` receives it. `updateName` is the only mutation used.
 *
 * ATTRIBUTES ARE PART OF THE FIXTURE NOW, and that is the lesson of #588. These tests used to build
 * a span named `HTTP GET` with no attributes, because the processor recognised fetch spans by name.
 * instrumentation-fetch stopped using that name at 0.223 — it emits the bare method — so the
 * fixture was asserting a rename of a name no library produced, and agreed with a predicate that
 * looked for it. Both halves were wrong together, which is why every control passed.
 *
 * The real span carries `http.request.method`; that is what the processor matches now, and what a
 * fixture has to carry to mean anything. `spanContract.instrumentation.test.ts` takes the same shape
 * from the INSTALLED package rather than from a literal, so a future rename fails there.
 */
const startable = (name: string, attributes: Record<string, unknown> = {}) => {
  let current = name
  return {
    attributes,
    get name() { return current },
    updateName(next: string) { current = next; return this },
  }
}

/** A minimal ReadableSpan, as `onEnd` receives it: `name` is READ-ONLY here, which is the point. */
const ended = (name: string, attributes: Record<string, unknown> = {}) => ({ attributes, name })

const PREFIX = 'https://portal.krateo.dev/content'
/** A fetch span as instrumentation-fetch 0.223+ actually makes one: bare method + the semconv attr. */
const autoFetchSpan = (method: string) =>
  startable(method, { 'http.request.method': method, 'url.full': `${PREFIX}/x` })

const harness = (prefix: string | null = PREFIX) => {
  const inner = {
    forceFlush: vi.fn(() => Promise.resolve()),
    onEnd: vi.fn(),
    onStart: vi.fn(),
    shutdown: vi.fn(() => Promise.resolve()),
  }
  return { inner, processor: new ContractSpanProcessor(inner, prefix) }
}

describe('the five names are the whole accepted set', () => {
  it('names exactly the five the SLI keys on', () => {
    expect(Object.values(SPAN_NAMES).sort()).toEqual([
      'krateo.composition.open',
      'krateo.form.submit',
      'krateo.page.load',
      'krateo.page.publish',
      'krateo.widget.fetch',
    ])
  })
})

describe('auto-instrumented fetch spans are RENAMED, and renamed at START', () => {
  it('renames a fetch span to krateo.widget.fetch', () => {
    const { processor } = harness()
    const span = autoFetchSpan('GET')
    processor.onStart(span as never, {} as never)
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)
  })

  it('renames every method, not just GET', () => {
    const { processor } = harness()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const span = autoFetchSpan(method)
      processor.onStart(span as never, {} as never)
      expect(span.name).toBe(SPAN_NAMES.widgetFetch)
    }
  })

  it('does NOT rename a span that merely LOOKS like the old name but carries no method attribute', () => {
    // The shape this file used to assert a rename for. Nothing emits it, and matching it by name is
    // what broke on the 0.223 bump — so it must not be rehabilitated by accident.
    const { processor } = harness()
    const span = startable('HTTP GET')
    processor.onStart(span as never, {} as never)
    expect(span.name).toBe('HTTP GET')
  })

  it('leaves a contract span alone', () => {
    const { processor } = harness()
    const span = startable(SPAN_NAMES.formSubmit)
    processor.onStart(span as never, {} as never)
    expect(span.name).toBe(SPAN_NAMES.formSubmit)
  })

  it('does not rename something merely resembling the auto pattern', () => {
    const { processor } = harness()
    for (const name of ['HTTP', 'HTTP get', 'http GET', 'HTTP GET /pods']) {
      const span = startable(name)
      processor.onStart(span as never, {} as never)
      expect(span.name).toBe(name)
    }
  })

  it('always forwards onStart, renamed or not — the inner processor must still see every span', () => {
    const { inner, processor } = harness()
    processor.onStart(startable('HTTP GET') as never, {} as never)
    processor.onStart(startable('something.else') as never, {} as never)
    expect(inner.onStart).toHaveBeenCalledTimes(2)
  })
})

describe('on END, only contract spans survive', () => {
  it('drops a name the contract does not list', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended('documentFetch') as never)
    processor.onEnd(ended('HTTP GET') as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('passes the three interaction spans through without needing a URL', () => {
    const { inner, processor } = harness()
    for (const name of [SPAN_NAMES.compositionOpen, SPAN_NAMES.formSubmit, SPAN_NAMES.pagePublish]) {
      processor.onEnd(ended(name) as never)
    }
    expect(inner.onEnd).toHaveBeenCalledTimes(3)
  })

  it('passes page.load through — outside the SLO, but still exported', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.pageLoad) as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })

  it('keeps an ABANDONED interaction span rather than dropping it', () => {
    // acmp's rule: excluded from the latency SLI, not from the data. Dropping it would hide the
    // abandonment rate entirely, and a silently-missing span is worse than a marked one.
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.compositionOpen, { [ATTR_ABANDONED]: true }) as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })
})

describe('a renamed fetch span is exported only for requests UNDER the snowplow base', () => {
  const fetchSpan = (url: string) => ended(SPAN_NAMES.widgetFetch, { 'http.url': url })

  it('exports a snowplow call', () => {
    const { inner, processor } = harness()
    processor.onEnd(fetchSpan('https://portal.krateo.dev/content/call?resource=tables') as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })

  it('DROPS same-origin calls that are not snowplow — the bug an origin check had', () => {
    // 057 serves portal, snowplow AND authn from one origin, so an origin check exported authn
    // calls and the SPA's own config fetch as widget fetches. A prefix is what identifies snowplow.
    const { inner, processor } = harness()
    for (const url of [
      'https://portal.krateo.dev/auth/login',
      'https://portal.krateo.dev/config/config.json',
      'https://portal.krateo.dev/',
      'https://portal.krateo.dev/contentious/call',
    ]) {
      processor.onEnd(fetchSpan(url) as never)
    }
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('DROPS another origin entirely', () => {
    const { inner, processor } = harness()
    for (const url of ['https://cdn.example.com/x.js', 'https://api.github.com/repos']) {
      processor.onEnd(fetchSpan(url) as never)
    }
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('reads the NEWER url.full attribute too, so a dependency bump cannot drop everything', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'url.full': `${PREFIX}/call` }) as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })

  it('DROPS a fetch span with no URL attribute — "cannot tell" is not "ours"', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.widgetFetch) as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('drops a malformed URL rather than throwing at the exporter', () => {
    const { inner, processor } = harness()
    processor.onEnd(fetchSpan('ht!tp://:::') as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('exports nothing at all when no snowplow base is configured', () => {
    const { inner, processor } = harness(null)
    processor.onEnd(fetchSpan(`${PREFIX}/call`) as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })
})

describe('redactUrlAttributes: route template in, raw URL out', () => {
  /** The mutable API span `applyCustomAttributesOnSpan` receives, with the SDK attributes it reads. */
  const mutable = (attributes: Record<string, unknown>) => {
    const set: Record<string, unknown> = {}
    return {
      attributes,
      set,
      setAttribute(key: string, value: unknown) {
        set[key] = value
        attributes[key] = value
        return this
      },
    }
  }

  it('strips the query string and records the route', () => {
    const span = mutable({ 'http.url': `${PREFIX}/call?resource=tables&extras=%7B%22q%22%3A%22nginx%22%7D` })
    redactUrlAttributes(span as never, PREFIX)
    expect(span.set['http.url']).toBe(`${PREFIX}/call`)
    expect(span.set[ATTR_ROUTE]).toBe('/call')
  })

  it('NO exported attribute contains a question mark', () => {
    // acmp's requirement, asserted directly: a query string carries what the user filtered or
    // searched for, and must not leave the browser at all.
    const span = mutable({ 'http.url': `${PREFIX}/call?extras=%7B%22secret%22%3A1%7D` })
    redactUrlAttributes(span as never, PREFIX)
    for (const value of Object.values(span.set)) {
      expect(String(value)).not.toContain('?')
    }
  })

  it('redacts url.full as well, when that is the attribute present', () => {
    const span = mutable({ 'url.full': `${PREFIX}/call?x=1` })
    redactUrlAttributes(span as never, PREFIX)
    expect(span.set['url.full']).toBe(`${PREFIX}/call`)
  })

  it('still strips the query from a URL it cannot parse', () => {
    const span = mutable({ 'http.url': 'ht!tp://:::/call?secret=1' })
    redactUrlAttributes(span as never, PREFIX)
    expect(String(span.set['http.url'])).not.toContain('?')
  })

  it('sets no route for a URL outside the snowplow base, but still strips the query', () => {
    const span = mutable({ 'http.url': 'https://cdn.example.com/x.js?v=2' })
    redactUrlAttributes(span as never, PREFIX)
    expect(span.set[ATTR_ROUTE]).toBeUndefined()
    expect(String(span.set['http.url'])).not.toContain('?')
  })

  it('does nothing when there is no URL attribute', () => {
    const span = mutable({})
    redactUrlAttributes(span as never, PREFIX)
    expect(Object.keys(span.set)).toEqual([])
  })
})

describe('lifecycle is delegated, not reimplemented', () => {
  it('forwards forceFlush and shutdown', async () => {
    const { inner, processor } = harness()
    await processor.forceFlush()
    await processor.shutdown()
    expect(inner.forceFlush).toHaveBeenCalledOnce()
    expect(inner.shutdown).toHaveBeenCalledOnce()
  })
})

describe('the PROPAGATOR applies the same boundary as the export filter', () => {
  /*
   * acmp's review caught this: I fixed the boundary in the processor and left the propagator's
   * regex as a bare `^prefix`, so it still matched `…/contentious/call`. Same-origin that is
   * harmless — same-origin requests carry traceparent anyway — but cross-origin it sends trace
   * context to a look-alike path, and "one derivation, two consumers" is only true if both
   * consumers apply the same rule to it.
   *
   * The regex is rebuilt here from the same shape `initTracing` uses, because `initTracing`
   * registers a global provider and cannot be called in a unit test without side effects.
   */
  const PROPAGATE = new RegExp(`^${'https://portal\\.krateo\\.dev/content'}(?:[/?]|$)`)

  it('propagates to the snowplow base and below it', () => {
    for (const url of [
      'https://portal.krateo.dev/content',
      'https://portal.krateo.dev/content/call',
      'https://portal.krateo.dev/content?x=1',
    ]) {
      expect(PROPAGATE.test(url)).toBe(true)
    }
  })

  it('does NOT propagate to a look-alike path sharing the prefix', () => {
    for (const url of [
      'https://portal.krateo.dev/contentious/call',
      'https://portal.krateo.dev/content-other',
      'https://portal.krateo.dev/contentx',
    ]) {
      expect(PROPAGATE.test(url)).toBe(false)
    }
  })

  it('does NOT propagate to other paths on the same origin', () => {
    for (const url of ['https://portal.krateo.dev/auth/login', 'https://portal.krateo.dev/config/config.json']) {
      expect(PROPAGATE.test(url)).toBe(false)
    }
  })
})
