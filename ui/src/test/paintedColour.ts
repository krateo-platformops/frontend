/**
 * The colour antd's CSS-in-JS actually paints on an element in jsdom, as `#rrggbb`.
 *
 * antd 6 writes its colours as CSS variables (`color: var(--ant-color-text-light-solid)`) and
 * declares each variable on the element its theme scope sits on: the global tokens on the
 * ConfigProvider's `css-var-*` class, a component's own overrides on that component's root (an
 * Avatar's `ant-avatar-css-var`, the Steps' `ant-steps`). jsdom returns a declared custom property
 * on the element that declares it, but it neither inherits custom properties nor substitutes
 * `var()`. So this does both: a `var(--x)` is looked up on the element and then up its ancestors,
 * the way inheritance would find it, and a value that is itself a `var()` is resolved where it was
 * found. What the theme sets per component is then what the test reads, not the global token.
 */

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/

/** `value` with every `var(--x[, fallback])` replaced by what `--x` inherits at `element`. */
const substitute = (element: Element, value: string): string => {
  let resolved = value
  for (let found = VAR.exec(resolved); found; found = VAR.exec(resolved)) {
    const [reference, name, fallback = ''] = found
    let replacement = fallback.trim()
    for (let node: Element | null = element; node; node = node.parentElement) {
      const declared = getComputedStyle(node).getPropertyValue(name).trim()
      if (declared) {
        // Resolved where it is declared, as a browser computes a custom property before inheriting it.
        replacement = substitute(node, declared)
        break
      }
    }
    resolved = resolved.replace(reference, replacement)
  }
  return resolved
}

/**
 * `#rgb`, `#rrggbb` or an opaque `rgb[a]()` as `#rrggbb`, so a painted colour compares to a token.
 * A translucent colour (antd's text tiers are `rgba(…, 0.88)`) is returned as written: it equals no
 * opaque token, so an assertion against one fails and names what was painted.
 */
export const toHex = (value: string): string => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1]
    return `#${digits.toLowerCase()}`
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1\s*)?\)$/i.exec(value)
  if (rgb) {
    return `#${rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`
  }
  if (/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0?\.\d+\s*\)$/i.test(value)) { return value }
  throw new Error(`not a colour: "${value}"`)
}

/** The element's text colour. */
export const paintedInk = (element: Element): string => toHex(substitute(element, getComputedStyle(element).color))

/**
 * The element's fill. An inline `background-color` (React's `style` prop) wins over any stylesheet
 * rule that is not `!important`, as in a browser. Otherwise antd's rule is the `background`
 * shorthand, which jsdom does not expand into `background-color` when it holds a `var()`, so the
 * shorthand is read.
 */
export const paintedFill = (element: HTMLElement): string => {
  if (element.style.backgroundColor) { return toHex(element.style.backgroundColor) }
  return toHex(substitute(element, getComputedStyle(element).getPropertyValue('background')))
}
