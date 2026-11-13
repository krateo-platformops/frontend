/**
 * The public page's ground. RECORDED ON MAIN, before a branded card stretched to the screen's
 * height on a phone: on a wide screen and at 575px and under the page sets no background of its own
 * (the app canvas shows). The phone rule must keep it so: the card fills the screen on its own
 * surface, as the sign-in card does, and the page is never painted to hide a seam.
 *
 * jsdom applies no stylesheet, so this reads the module's rules (as PublicPage.paddingUnchanged).
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

describe('the public page ground, as today', () => {
  it('wide screens and 575px and under: no background of its own', () => {
    expect(pageRule()).not.toMatch(/background/)
    expect(pageRule(575)).not.toMatch(/background/)
  })
})
