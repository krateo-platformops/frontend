// @vitest-environment jsdom
/**
 * Resuming a draft must SHOW work, never consume it. The teardown assertion below is the one that
 * matters: the apply path arms a drawer-close delete for what it created, and resuming created
 * nothing — so a resumed drawer that armed one would make opening your own draft the act that
 * destroys it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EVENT } from './previewBus'
import { RESUME_PARAM, resumePreviewDraft, resumeSlugFrom } from './resumePreviewDraft'

const SANDBOX = 'krateo-preview'

const captureOpen = (): { last: Record<string, unknown> | null; off: () => void } => {
  const sink: { last: Record<string, unknown> | null; off: () => void } = { last: null, off: () => undefined }
  const listener = (event: Event): void => { sink.last = (event as CustomEvent<Record<string, unknown>>).detail }
  window.addEventListener(AUTOPILOT_PREVIEW_EVENT, listener)
  sink.off = () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, listener)

  return sink
}

afterEach(() => vi.restoreAllMocks())

describe('resumeSlugFrom — what the drafts table hands back', () => {
  it('reads the slug the rowNavigateTo carries', () => {
    expect(resumeSlugFrom(`?${RESUME_PARAM}=fleet-overview`)).toBe('fleet-overview')
    expect(resumeSlugFrom(`?other=x&${RESUME_PARAM}=cost-report&z=1`)).toBe('cost-report')
  })

  it('returns null when there is nothing to resume', () => {
    expect(resumeSlugFrom('')).toBeNull()
    expect(resumeSlugFrom('?range=7d')).toBeNull()
    expect(resumeSlugFrom(`?${RESUME_PARAM}=`)).toBeNull()
  })

  it.each([
    ['upper case', 'Fleet'],
    ['a slash — path traversal shape', 'a/b'],
    ['a leading dash', '-x'],
    ['spaces', 'my page'],
  ])('REFUSES %s rather than building an endpoint from it', (_label, bad) => {
    // The slug becomes a CR name in the endpoint this opens, so a crafted value must resolve to
    // nothing rather than to a request for some other object.
    expect(resumeSlugFrom(`?${RESUME_PARAM}=${encodeURIComponent(bad)}`)).toBeNull()
  })
})

describe('resumePreviewDraft — opens the draft that is already there', () => {
  it('opens the live drawer on the page-<slug> root in the sandbox', () => {
    const sink = captureOpen()
    expect(resumePreviewDraft('fleet-overview', SANDBOX)).toBe(true)

    const payload = sink.last!
    expect(payload.title).toBe('Draft — fleet-overview')
    // The page ENTRY is the root Flex — the same identity the apply path mounts.
    expect(String(payload.liveEndpoint)).toContain('name=page-fleet-overview')
    expect(String(payload.liveEndpoint)).toContain(`namespace=${SANDBOX}`)
    expect(String(payload.liveEndpoint)).toContain('resource=flexes')
    sink.off()
  })

  it('arms NO teardown — closing a resumed drawer must leave the draft alone', () => {
    const sink = captureOpen()
    resumePreviewDraft('fleet-overview', SANDBOX)

    // The apply path sets onClose to delete what it created. Resuming created nothing, so an
    // onClose here would delete a draft this session never made.
    expect(sink.last!.onClose).toBeUndefined()
    sink.off()
  })

  it('refuses rather than opening an empty drawer', () => {
    const sink = captureOpen()
    // no sandbox configured
    expect(resumePreviewDraft('fleet-overview', '')).toBe(false)
    expect(resumePreviewDraft('Bad Slug', SANDBOX)).toBe(false)
    expect(sink.last).toBeNull()
    sink.off()
  })
})
