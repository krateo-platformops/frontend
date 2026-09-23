// @vitest-environment jsdom
/**
 * THE CAPTION HAS TO DESCRIBE THE SURFACE THE READER IS LOOKING AT.
 *
 * `LIVE_PREVIEW_CAPTION` is written for the drawer and says so — it ends "Closing this drawer
 * removes them". The composer embeds the SAME `PreviewContent` inline, in the lower half of its
 * split, where there is no drawer to close and the equivalent control is "Close draft".
 *
 * So the composer was telling a reader to close something that was not on their screen. Spotted by
 * watching a recording of the page, where the sentence sat under the Layout panel reading
 * "…permissions. Closing this drawer removes them."
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ThemeModeProvider } from '../../context/ThemeModeContext'

import { LIVE_PREVIEW_CAPTION, LIVE_PREVIEW_CAPTION_INLINE } from './previewPageV2'
import { PreviewContent } from './previewSurface'

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  vi.stubGlobal('ResizeObserver', class {
    disconnect() { /* inert */ }
    observe() { /* inert */ }
    unobserve() { /* inert */ }
  })
})
afterEach(cleanup)

const payload = { caption: LIVE_PREVIEW_CAPTION, objects: [], verb: 'previewPage' } as never

describe('the live-preview caption', () => {
  it('keeps the DRAWER wording when nothing overrides it', () => {
    render(<ThemeModeProvider><PreviewContent editVerdicts={null} onVerdicts={vi.fn()} payload={payload} /></ThemeModeProvider>)
    expect(screen.getByText(/Closing this drawer removes them/)).toBeTruthy()
  })

  it('uses the CALLER\'s wording when one is given — the composer has no drawer', () => {
    render(<ThemeModeProvider><PreviewContent caption={LIVE_PREVIEW_CAPTION_INLINE} editVerdicts={null} onVerdicts={vi.fn()} payload={payload} /></ThemeModeProvider>)

    expect(screen.getByText(/Closing the draft removes it/)).toBeTruthy()
    expect(screen.queryByText(/Closing this drawer/)).toBeNull()
  })

  it('the inline wording names a control that EXISTS in the composer', () => {
    // "Close draft" is the composer's button. A caption naming a control the reader cannot find is
    // the same defect as naming a drawer that is not there.
    expect(LIVE_PREVIEW_CAPTION_INLINE.toLowerCase()).toContain('draft')
    expect(LIVE_PREVIEW_CAPTION_INLINE.toLowerCase()).not.toContain('drawer')
  })

  it('both still say WHERE the draft went and WHOSE permissions rendered it', () => {
    // The caption's job: this is real, it is quarantined, and it is your access — not a mockup.
    for (const text of [LIVE_PREVIEW_CAPTION, LIVE_PREVIEW_CAPTION_INLINE]) {
      expect(text).toContain('quarantined preview sandbox')
      expect(text).toContain('rendered by the real server')
      expect(text).toContain('your identity and permissions')
    }
  })

  it('shows nothing at all when there is no caption either way', () => {
    const bare = { objects: [], verb: 'previewPage' } as never
    render(<ThemeModeProvider><PreviewContent editVerdicts={null} onVerdicts={vi.fn()} payload={bare} /></ThemeModeProvider>)
    expect(screen.queryByText(/quarantined preview sandbox/)).toBeNull()
  })
})
