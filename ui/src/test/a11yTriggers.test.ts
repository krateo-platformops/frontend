/**
 * C10 — A CLICK-TRIGGERED MENU'S TRIGGER IS ITSELF FOCUSABLE (design/02-components.md).
 *
 * antd's Popover, Dropdown and Popconfirm bind `onClick` to their child and add no keyboard
 * affordance of their own. When the child is a `<span>` (an `Avatar`, an icon, a `Text`), the menu
 * cannot be opened without a mouse. That is how the account menu was unreachable on every page
 * until #195. jsx-a11y cannot see this: the handler is attached at runtime, by antd, to an element
 * that carries no handler in the source.
 *
 * So this reads the source. For every `<Popover|Dropdown|Popconfirm>` it takes the single element
 * child (looking through a `<Tooltip>`, which wraps the trigger without being it) and requires it
 * to be focusable:
 *   - a native control (`button`, `a`, `input`, `select`, `textarea`), or a component that renders
 *     one (antd `Button`/`Input`, the shared `HeaderIconButton`);
 *   - or anything that sets `tabIndex` itself.
 * A child the source cannot name (`{children}`, a spread) is not judged: guessing would make the
 * check noisy, and a noisy check is the kind that gets switched off.
 *
 * No baseline: all four triggers in the tree pass today. Keep it that way.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const TRIGGERS = new Set(['Dropdown', 'Popconfirm', 'Popover'])
const FOCUSABLE = new Set(['a', 'Button', 'button', 'HeaderIconButton', 'Input', 'input', 'select', 'textarea'])

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { return walk(path) }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : []
  })

type Element = ts.JsxElement | ts.JsxSelfClosingElement

const tagOf = (node: Element): string =>
  (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText()

const attributesOf = (node: Element): ts.JsxAttributes =>
  (ts.isJsxElement(node) ? node.openingElement : node).attributes

/** The element children, skipping whitespace and `{/* comments *\/}`. `null` when a child is opaque. */
const elementChildren = (node: ts.JsxElement): Element[] | null => {
  const out: Element[] = []
  for (const child of node.children) {
    if (ts.isJsxText(child) && child.text.trim() === '') { continue }
    if (ts.isJsxExpression(child) && !child.expression) { continue }
    if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) { return null }
    out.push(child)
  }
  return out
}

/** The trigger element: the single child, looking through a Tooltip. `null` when it cannot be named. */
const triggerOf = (node: ts.JsxElement): Element | null => {
  const children = elementChildren(node)
  if (!children || children.length !== 1) { return null }
  const [child] = children
  return tagOf(child) === 'Tooltip' && ts.isJsxElement(child) ? triggerOf(child) : child
}

const isFocusable = (node: Element): boolean | null => {
  const attributes = attributesOf(node).properties
  if (attributes.some(ts.isJsxSpreadAttribute)) { return null }
  return FOCUSABLE.has(tagOf(node)) || attributes.some((attribute) => attribute.name?.getText() === 'tabIndex')
}

const scan = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && TRIGGERS.has(tagOf(node))) {
      const trigger = triggerOf(node)
      if (trigger && isFocusable(trigger) === false) {
        const { line } = source.getLineAndCharacterOfPosition(trigger.getStart())
        hits.push(`${file}:${line + 1} <${tagOf(node)}> opens from <${tagOf(trigger)}>, which cannot take focus`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

describe('C10 — menu triggers are focusable', () => {
  it('every Popover / Dropdown / Popconfirm opens from something the keyboard can reach', () => {
    const hits = walk(ROOT).flatMap((path) => scan(path.slice(ROOT.length + 1), readFileSync(path, 'utf8')))
    expect(hits, 'wrap the trigger in a <button> (see UserMenu.tsx) or give it tabIndex and a key handler').toEqual([])
  })

  // A check that has stopped firing is worse than no check.
  it('fires on the shapes it claims to see, and stays silent on the ones it should', () => {
    const fixture = `
      const a = <Popover content='x' trigger='click'><Avatar /></Popover>
      const b = <Dropdown menu={m}><Tooltip title='t'><span>open</span></Tooltip></Dropdown>
      // silent from here down
      const c = <Popover content='x'><button type='button'>open</button></Popover>
      const d = <Dropdown menu={m}><Tooltip title='t'><Button aria-label='More' /></Tooltip></Dropdown>
      const e = <Popconfirm title='Sure?'><span role='button' tabIndex={0}>delete</span></Popconfirm>
      const f = <Popover content='x'>{children}</Popover>
      const g = <Popover content='x'><Trigger {...props} /></Popover>
    `
    expect(scan('fixture.tsx', fixture).map((hit) => hit.replace(/^fixture\.tsx:\d+ /, ''))).toEqual([
      '<Popover> opens from <Avatar>, which cannot take focus',
      '<Dropdown> opens from <span>, which cannot take focus',
    ])
  })
})
