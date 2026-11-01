// @vitest-environment jsdom
/**
 * `resolveAutopilotAnchor` turns a tour step's semantic anchor into a live DOM element, and
 * returns null when it can't — on purpose, because a step with no target renders centered
 * instead of breaking the walkthrough. It had no tests at all, which is a bad combination with
 * a deliberately silent failure: the `nav:` branch used to select antd's `.ant-menu-item`, so an
 * antd class rename (it renamed six of ours in antd 6 — #588/#590) would have switched every nav
 * spotlight off forever, with nothing thrown, nothing logged and nothing to look at.
 *
 * These pin both halves: that each anchor kind still resolves, that a genuine absence still
 * degrades QUIETLY, and that the one shape which cannot be a legitimate absence — a nav on
 * screen carrying none of our own anchors — is loud.
 */
import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NAV_ITEM_ATTRIBUTE, NAV_ROOT_ATTRIBUTE } from '../../widgets/Menu/navAnchor'

// The tour component itself pulls the whole Autopilot context in; only the resolver is under test.
vi.mock('./AutopilotProvider', () => ({ useAutopilot: () => ({ closeTour: vi.fn(), tour: null, tourOpen: false }) }))

const { resolveAutopilotAnchor } = await import('./AutopilotTour')

/** The sidebar nav as widgets/Menu renders it: a stamped root, one stamped row per entry. */
const renderNav = (labels: string[]) => {
  document.body.innerHTML = `<ul ${NAV_ROOT_ATTRIBUTE}="">${labels
    .map((label) => `<li ${NAV_ITEM_ATTRIBUTE}="${label}"><span>${label}</span></li>`)
    .join('')}</ul>`
}

// Typed to console.error's own signature: `ReturnType<typeof vi.spyOn>` carries `any` args, so
// the `.mock.calls[0][0]` assertion below would check nothing (same reason as transcribe.test.ts).
let consoleError: MockInstance<(message: string) => void>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => { /* silenced */ })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('resolveAutopilotAnchor — nav:', () => {
  it('spotlights the nav row with that label', () => {
    renderNav(['Compositions', 'Blueprints'])

    const resolved = resolveAutopilotAnchor('nav:Blueprints')

    expect(resolved?.tagName).toBe('LI')
    expect(resolved?.getAttribute(NAV_ITEM_ATTRIBUTE)).toBe('Blueprints')
  })

  it('does NOT read antd class names — a nav wearing only antd classes resolves nothing', () => {
    // The guard against the resolution this replaces: antd's class is no longer an anchor, so
    // a resolver that went back to `.ant-menu-item` would resolve this and fail here.
    document.body.innerHTML = '<ul class="ant-menu"><li class="ant-menu-item">Blueprints</li></ul>'

    expect(resolveAutopilotAnchor('nav:Blueprints')).toBeNull()
  })

  it('matches the label exactly, not loosely', () => {
    renderNav(['Blueprints'])

    expect(resolveAutopilotAnchor('nav:Blue')).toBeNull()
    expect(resolveAutopilotAnchor('nav:Blueprints and more')).toBeNull()
  })

  it('tolerates whitespace around the anchor value', () => {
    renderNav(['Compositions'])

    expect(resolveAutopilotAnchor('nav:  Compositions  ')).not.toBeNull()
  })

  describe('when it finds nothing', () => {
    it('degrades quietly for a label this nav does not have', () => {
      renderNav(['Compositions'])

      expect(resolveAutopilotAnchor('nav:Marketplace')).toBeNull()
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('degrades quietly on a page with no nav at all', () => {
      document.body.innerHTML = '<main><h1>Login</h1></main>'

      expect(resolveAutopilotAnchor('nav:Compositions')).toBeNull()
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('degrades quietly for a nav emptied by RBAC — a root with no rows', () => {
      renderNav([])

      expect(resolveAutopilotAnchor('nav:Compositions')).toBeNull()
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('is LOUD when the nav rendered rows but carries none of our anchors', () => {
      // The failure that used to be indistinguishable from an absent nav item: rows are on
      // screen, so this is our hook having stopped reaching the DOM, not an empty page.
      document.body.innerHTML = `<ul ${NAV_ROOT_ATTRIBUTE}=""><li><span>Compositions</span></li></ul>`

      expect(resolveAutopilotAnchor('nav:Compositions')).toBeNull()
      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(String(consoleError.mock.calls[0][0])).toContain(NAV_ITEM_ATTRIBUTE)
    })
  })
})

describe('resolveAutopilotAnchor — action: and text:', () => {
  it('finds a button by a substring of its label', () => {
    document.body.innerHTML = '<button type="button">Create composition</button>'

    expect(resolveAutopilotAnchor('action:Create')?.tagName).toBe('BUTTON')
  })

  it('returns null when no button carries the text', () => {
    document.body.innerHTML = '<button type="button">Cancel</button>'

    expect(resolveAutopilotAnchor('action:Create')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('finds the smallest leaf carrying the text', () => {
    document.body.innerHTML = '<section><h2>Fleet health</h2><p><span>Fleet health</span></p></section>'

    expect(resolveAutopilotAnchor('text:Fleet health')?.tagName).toBe('H2')
  })

  it('never points at the Autopilot rail itself', () => {
    document.body.innerHTML = '<div class="_apRail_1a2b3"><span>Fleet health</span></div>'

    expect(resolveAutopilotAnchor('text:Fleet health')).toBeNull()
  })
})

describe('resolveAutopilotAnchor — malformed anchors', () => {
  it.each([
    ['no separator', 'Compositions'],
    ['empty value', 'nav:'],
    ['blank value', 'nav:   '],
    ['unknown kind', 'widget:Compositions'],
    ['empty string', ''],
  ])('returns null for %s', (_name, anchor) => {
    renderNav(['Compositions'])

    expect(resolveAutopilotAnchor(anchor)).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
