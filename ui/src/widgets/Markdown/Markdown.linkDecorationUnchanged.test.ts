/**
 * How a Markdown link is decorated. RECORDED ON MAIN, before a `tone: secondary` link was
 * underlined: no rule of the module sets `text-decoration` on a link, so a link in a Markdown
 * without `tone` keeps the portal's link style (colour, no underline). The commit that underlines
 * the muted line's links must keep that for every other Markdown.
 *
 * jsdom applies no stylesheet, so this reads the module's rules.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'Markdown.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Markdown links, as today', () => {
  it('no rule underlines a link outside tone: secondary', () => {
    const linkRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1].split(',').some((part) => /(^|\s)a(\s|:|$)/.test(part.trim()) && !part.includes('.secondary')))
    expect(linkRules.filter((match) => /text-decoration/.test(match[2]))).toEqual([])
  })
})
