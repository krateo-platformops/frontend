// @vitest-environment jsdom
/**
 * The portal's two text faces (the login and sidebar redesign, 2026-11-11): Inter for body text,
 * labels, inputs, tables and the menu; Syne for the display role only — page titles, the sign-in
 * heading, the agent's own titles. From 2026-11-06 to this change Syne set every role, and at
 * 12-14px it cost the narrow sidebar labels and table columns 10-15% of their width.
 *
 * Pinned at each place the face is decided: the token, the antd theme, the CSS variables the
 * component CSS reads, and the rules that put a title in the display face. visual/typeface.spec.ts
 * reads the faces the browser actually resolves.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cssVariables, darkTheme, lightTheme, typography } from './tokens'

/** The first family of a CSS font stack, unquoted. */
const first = (stack: string): string => stack.split(',')[0].trim().replace(/^["']|["']$/g, '')

const css = (path: string): string => readFileSync(join(__dirname, '..', '..', path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** The declarations of the rule whose selector is exactly `selector` (the first one, if several). */
const rule = (source: string, selector: string): string => {
  const found = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) => match[1].trim() === selector)
  if (!found) { throw new Error(`no ${selector} rule`) }
  return found[2]
}

describe('the body face is Inter, the display face Syne', () => {
  it('body: Inter first, and no Syne anywhere in the stack', () => {
    expect(first(typography.family)).toBe('Inter')
    expect(typography.family).not.toMatch(/Syne/)
  })

  it('display: Syne first, with Inter as its fallback', () => {
    expect(first(typography.display)).toBe('Syne')
    expect(typography.display.split(',').map((family) => family.trim())[1]).toBe('Inter')
  })

  it('data stays JetBrains Mono', () => {
    expect(first(typography.mono)).toBe('JetBrains Mono')
  })

  it('antd draws every component in the body face, in both modes', () => {
    expect(lightTheme.token?.fontFamily).toBe(typography.family)
    expect(darkTheme.token?.fontFamily).toBe(typography.family)
  })
})

describe('the CSS variables the component CSS reads', () => {
  afterEach(() => { document.documentElement.removeAttribute('style') })

  ;(['light', 'dark'] as const).forEach((mode) => {
    it(`${mode}: --font-family / --krateo-font-ui / --krateo-font-agentiko are Inter, --font-display / --krateo-font-display are Syne`, () => {
      cssVariables(mode)
      const read = (name: string) => first(document.documentElement.style.getPropertyValue(name))
      expect({
        agentiko: read('--krateo-font-agentiko'),
        display: read('--font-display'),
        family: read('--font-family'),
        krateoDisplay: read('--krateo-font-display'),
        ui: read('--krateo-font-ui'),
      }).toEqual({ agentiko: 'Inter', display: 'Syne', family: 'Inter', krateoDisplay: 'Syne', ui: 'Inter' })
    })
  })
})

/**
 * A title is in the display face only where its rule says so: antd draws a Typography.Title in the
 * theme's (body) fontFamily. While body and display were both Syne these rules made no difference;
 * now each is the only thing keeping a page title in Syne.
 */
describe('titles take the display face', () => {
  it.each([
    ['the PageHeader widget\'s title', 'src/widgets/PageHeader/PageHeader.module.css', '.title', 'var(--font-display)'],
    ['a ScreenHeader\'s title (the builders)', 'src/components/ScreenHeader/ScreenHeader.module.css', '.title', 'var(--font-display)'],
    ['the agent rail\'s title', 'src/components/Agentiko/AgentikoRail.module.css', '.apTitle', 'var(--krateo-font-display)'],
    ['the agent rail\'s empty-state title', 'src/components/Agentiko/AgentikoRail.module.css', '.apEmpty .apEmptyTitle', 'var(--krateo-font-display)'],
    ['the agent rail\'s locked-state title', 'src/components/Agentiko/AgentikoRail.module.css', '.apLockedTitle', 'var(--krateo-font-display)'],
  ])('%s', (_name, file, selector, face) => {
    expect(rule(css(file), selector)).toContain(`font-family: ${face};`)
  })

  it('a stat value is data, not a title: it stays in the body face', () => {
    expect(rule(css('index.css'), '.ant-statistic-content-value')).not.toMatch(/font-display/)
  })
})
