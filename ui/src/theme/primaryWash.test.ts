/**
 * The Brand-v2 primary WASH (ui/index.css) must leave a DISABLED primary button looking disabled.
 *
 * The wash restyles antd's solid primary at the cascade level, with a selector more specific than
 * antd's own `:disabled` rule — so while its base rule matched disabled buttons too, a disabled
 * primary kept the full brand wash, border and label, identical to an enabled one but for the
 * cursor. The Blueprint Composer's Publish is off until a preview stands, and "off" was invisible
 * (a keyboard user could not even reach it to hover the reason). Every rule of the wash that paints
 * the button must therefore exclude `:disabled` / `.ant-btn-disabled`, and leave antd's disabled
 * style — the one Undo shows — to apply.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** A selector list split at its top-level commas — not the ones inside `:not(a, b)`. */
const splitSelectors = (list: string): string[] => {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else {
      if (char === '(') { depth += 1 }
      if (char === ')') { depth -= 1 }
      current += char
    }
  }
  return [...out, current.trim()]
}

/** Every `selector { body }` rule whose selector names the solid primary variant. */
const washRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ body: match[2], selectors: splitSelectors(match[1]) }))
  .filter((rule) => rule.selectors.some((selector) => selector.includes('.ant-btn-color-primary.ant-btn-variant-solid')))

describe('the primary wash leaves a disabled button disabled-looking', () => {
  it('finds the wash — the filter did not silently match nothing', () => {
    expect(washRules.length).toBeGreaterThan(0)
  })

  it('no selector that paints the button reaches a disabled one', () => {
    const painting = washRules.filter((rule) => /\b(background|border-color|color)\s*:/.test(rule.body))
    const reachesDisabled = painting
      .flatMap((rule) => rule.selectors)
      .filter((selector) => selector.includes('.ant-btn-variant-solid') && !/:not\(:disabled,\s*\.ant-btn-disabled\)/.test(selector))
    expect(reachesDisabled).toEqual([])
  })
})
