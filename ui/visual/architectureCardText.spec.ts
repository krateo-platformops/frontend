/**
 * THE ARCHITECTURE CARD'S TEXT AT THE 12px FLOOR, in a real browser.
 *
 * Every line on FlowChart's architecture card is at least `text-caption` (12px): the kind line and
 * the exception chip were `text-label-xs`, 10px, under the portal's type floor, and were raised. At
 * 12px a forEach kind and an exception chip no longer shared the 220px card's eyebrow, so the
 * regular card is 240×84 (compact stays 180×56); those are the boxes dagre reserves. The CSS module
 * is pinned at or above the floor, and to those boxes, by architectureFit.test.ts; what jsdom cannot
 * show is whether the text fits the box once a real font sets it. This measures it, at both densities, with the
 * longest values a chart realistically hands the card (main.tsx `?fixture=architecture-cards`).
 *
 * WHAT "FITS" MEANS PER LINE. Nothing wraps, and nothing is drawn outside the card's border. The
 * exception label is always in full. The kind and detail lines are one line, cut with an ellipsis
 * where they must be; the kind is in full, alone or beside either chip. The name is cut as it always
 * was: one line and an ellipsis on the regular card, two lines and an ellipsis on the compact one,
 * the full name in its `title`.
 */
import { expect, test, type Page } from '@playwright/test'

type Line = {
  /** Distinct line boxes the text was set on. */
  lines: number
  /** The rendered font size, px. */
  fontSize: number
  /** The text is wider than its box (cut with an ellipsis). */
  cut: boolean
  /** The ellipsis rule applies (single-line `text-overflow`, or the compact name's line clamp). */
  ellipsis: boolean
  /** Inside the card's border. */
  inside: boolean
  /** The width the text needs, and the width it is given, px. */
  needed: number
  shown: number
  role: 'detail' | 'exception' | 'kind' | 'name'
  text: string
}
type Card = { case: string; density: string; height: number; lines: Line[]; overflowX: boolean; overflowY: boolean; width: number }

const measure = () => [...document.querySelectorAll<HTMLElement>('[data-case]')].map((wrapper): Card => {
  const card = wrapper.querySelector<HTMLElement>('[role="group"]')!
  const density = wrapper.dataset.densityCase!
  const outer = card.getBoundingClientRect()
  const border = Number.parseFloat(getComputedStyle(card).borderTopWidth)
  const inner = { bottom: outer.bottom - border, left: outer.left + border, right: outer.right - border, top: outer.top + border }
  // The lines with a `title` are, in order, kind (regular only), name, detail; the exception is its own.
  const titled = [...card.querySelectorAll<HTMLElement>('span[title]')]
  const roles: Line['role'][] = density === 'compact' ? ['name', 'detail'] : ['kind', 'name', 'detail']
  const elements: [Line['role'], HTMLElement][] = titled.map((element, index) => [roles[index], element])
  const exception = card.querySelector<HTMLElement>('[data-testid="architecture-exception"]')
  if (exception?.textContent) {
    elements.push(['exception', exception])
  }
  const lines = elements.map(([role, element]): Line => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    // The line boxes of the TEXT only (not the exception's dot), by their vertical centre: a line the
    // clamp hides sits below the element's box, and a glyph's box may rise above a tight line-height.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const centres = new Set<number>()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        const centre = (rect.top + rect.bottom) / 2
        if (rect.width > 0 && centre >= box.top && centre <= box.bottom) {
          centres.add(Math.round(centre))
        }
      }
    }
    return {
      cut: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      ellipsis: style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none',
      fontSize: Number.parseFloat(style.fontSize),
      inside: box.left >= inner.left - 0.5 && box.right <= inner.right + 0.5 && box.top >= inner.top - 0.5 && box.bottom <= inner.bottom + 0.5,
      lines: centres.size,
      needed: element.scrollWidth,
      role,
      shown: element.clientWidth,
      text: element.textContent ?? '',
    }
  })
  return {
    case: wrapper.dataset.case!,
    density,
    height: Math.round(outer.height),
    lines,
    overflowX: card.scrollWidth > card.clientWidth,
    overflowY: card.scrollHeight > card.clientHeight,
    width: Math.round(outer.width),
  }
})

const measured = async (page: Page): Promise<{ cards: Card[]; line: (name: string, role: Line['role']) => Line }> => {
  await page.goto('/visual/index.html?fixture=architecture-cards')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-case]')).toHaveCount(10)
  const cards = await page.evaluate(measure)
  const line = (name: string, role: Line['role']) => cards.find((card) => card.case === name)!.lines.find((each) => each.role === role)!
  return { cards, line }
}

test('every line of the architecture card fits its box at the 12px floor, at both densities', async ({ page }) => {
  const { cards, line: lineOf } = await measured(page)

  for (const card of cards) {
    const at = `${card.case}: ${JSON.stringify(card)}`
    // The box dagre reserves (ARCHITECTURE_DENSITY).
    expect([card.width, card.height], at).toEqual(card.density === 'compact' ? [180, 56] : [240, 84])
    expect([card.overflowX, card.overflowY], at).toEqual([false, false])
    for (const line of card.lines) {
      const of = `${card.case} ${line.role}: ${JSON.stringify(line)}`
      expect(line.fontSize, of).toBeGreaterThanOrEqual(12)
      expect(line.inside, of).toBe(true)
      if (line.role === 'name') {
        // Cut as it always was: one line (regular) or two (compact), then the ellipsis.
        expect(line.lines, of).toBeLessThanOrEqual(card.density === 'compact' ? 2 : 1)
        expect(line.ellipsis, of).toBe(true)
        continue
      }
      // Every other line is one line. Where it is cut, it is cut with an ellipsis, never wrapped.
      expect(line.lines, of).toBe(1)
      if (line.role === 'exception') {
        // The chip does not shrink (`flex: none`): its label is always in full.
        expect(line.cut, of).toBe(false)
      } else {
        expect(line.ellipsis, of).toBe(true)
      }
    }
  }

  // Not this change: the detail line was 12px before it, and a 30-character detail is cut on the
  // compact card's 154px (169px needed), as it was.
  expect(lineOf('compact/forEach-NotSynced', 'detail').cut).toBe(true)

  // The 63-character name is long enough to be cut on both cards (else the case proves nothing).
  for (const density of ['regular', 'compact']) {
    const name = lineOf(`${density}/long-name`, 'name')
    expect(name.text.length).toBe(63)
    expect(name.cut).toBe(true)
  }
})

test('the regular card\'s kind is in full, alone and beside either exception chip', async ({ page }) => {
  const { line } = await measured(page)

  // The kind line on its own, in full: `LOCALRESOURCE ×8` is 124px of the 214px inside the card.
  for (const name of ['regular/forEach', 'regular/long-name', 'regular/exception']) {
    expect(line(name, 'kind').cut, name).toBe(false)
  }

  // The kind in full BESIDE the exception chip: why the regular card is 240px. `LOCALRESOURCE ×8`
  // (124px) + 8px + `NotSynced` (75px) = 207px, or + `NotReady` (68px) = 200px, of the 214px a 240px
  // card leaves; the 220px card left 194, and cut the kind to 111px and 118px.
  for (const name of ['regular/forEach-NotSynced', 'regular/forEach-NotReady']) {
    const kind = line(name, 'kind')
    const chip = line(name, 'exception')
    expect(kind.cut, `${name}: ${JSON.stringify(kind)}`).toBe(false)
    expect(kind.shown, name).toBe(kind.needed)
    expect(kind.needed + 8 + chip.needed, name).toBeLessThanOrEqual(214)
  }
})
