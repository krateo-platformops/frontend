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

import { ATTR_ABANDONED, ContractSpanProcessor, SPAN_NAMES } from './spanContract'

/** A minimal mutable span, as `onStart` receives it. `updateName` is the only mutation used. */
const startable = (name: string) => {
  let current = name
  return {
    get name() { return current },
    updateName(next: string) { current = next; return this },
  }
}

/** A minimal ReadableSpan, as `onEnd` receives it: `name` is READ-ONLY here, which is the point. */
const ended = (name: string, attributes: Record<string, unknown> = {}) => ({ attributes, name })

const harness = (origins: readonly string[] = ['https://portal.krateo.dev']) => {
  const inner = {
    forceFlush: vi.fn(() => Promise.resolve()),
    onEnd: vi.fn(),
    onStart: vi.fn(),
    shutdown: vi.fn(() => Promise.resolve()),
  }
  return { inner, processor: new ContractSpanProcessor(inner, origins) }
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
  it('renames `HTTP GET` to krateo.widget.fetch', () => {
    const { processor } = harness()
    const span = startable('HTTP GET')
    processor.onStart(span as never, {} as never)
    expect(span.name).toBe(SPAN_NAMES.widgetFetch)
  })

  it('renames every method, not just GET', () => {
    const { processor } = harness()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const span = startable(`HTTP ${method}`)
      processor.onStart(span as never, {} as never)
      expect(span.name).toBe(SPAN_NAMES.widgetFetch)
    }
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

describe('a renamed fetch span is exported only for the origins we propagate to', () => {
  it('exports a snowplow request', () => {
    const { inner, processor } = harness(['https://portal.krateo.dev'])
    processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'http.url': 'https://portal.krateo.dev/content/call?resource=tables' }) as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })

  it('DROPS a request to any other origin — a static asset or a third party', () => {
    const { inner, processor } = harness(['https://portal.krateo.dev'])
    for (const url of ['https://cdn.example.com/x.js', 'https://api.github.com/repos', 'http://localhost:9999/x']) {
      processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'http.url': url }) as never)
    }
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('reads the NEWER url.full attribute too, so a dependency bump cannot drop everything', () => {
    // If instrumentation-fetch moves from `http.url` to `url.full` and only one is read, every
    // span becomes "origin unknown" and is dropped — invisibly. Both are read for that reason.
    const { inner, processor } = harness(['https://portal.krateo.dev'])
    processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'url.full': 'https://portal.krateo.dev/content/call' }) as never)
    expect(inner.onEnd).toHaveBeenCalledOnce()
  })

  it('DROPS a fetch span with no URL attribute at all — "cannot tell" is not "ours"', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.widgetFetch) as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('drops a malformed URL rather than throwing at the exporter', () => {
    const { inner, processor } = harness()
    processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'http.url': 'ht!tp://:::' }) as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
  })

  it('matches on ORIGIN, not on a prefix — a look-alike host is not ours', () => {
    const { inner, processor } = harness(['https://portal.krateo.dev'])
    processor.onEnd(ended(SPAN_NAMES.widgetFetch, { 'http.url': 'https://portal.krateo.dev.evil.test/content/call' }) as never)
    expect(inner.onEnd).not.toHaveBeenCalled()
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
