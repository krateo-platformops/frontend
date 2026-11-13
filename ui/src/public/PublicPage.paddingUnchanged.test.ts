/**
 * The public page's gutter above the phone breakpoint. RECORDED ON MAIN, before the page dropped its
 * gutter on a phone: the commit that does that must keep these — the page's padding on a wide
 * screen and on a small tablet are as they were.
 *
 * jsdom applies no stylesheet, so this reads the module's rules (as
 * pages/BlueprintBuilder/architectureCardStyles.test.ts does).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'PublicPage.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of `.page` at the top level, or inside the `@media (width <= Npx)` block. */
const pageRule = (maxWidth?: number): string => {
  const scope = maxWidth === undefined
    ? css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    : (css.match(new RegExp(`@media \\(width <= ${maxWidth}px\\)\\s*\\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`))?.[1] ?? '')
  return scope.match(/\.page\s*\{([^{}]*)\}/)?.[1] ?? ''
}

describe('the public page gutter, as today', () => {
  it('wide screens: --spacing-lg', () => {
    expect(pageRule()).toMatch(/padding:\s*var\(--spacing-lg\);/)
  })

  it('575px and under: --spacing-md', () => {
    expect(pageRule(575)).toMatch(/padding:\s*var\(--spacing-md\);/)
  })
})
