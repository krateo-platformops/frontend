/**
 * THE HEADERS THE APP BUILDS ITSELF follow the same two rules as the PageHeader widget.
 *
 * P26 — A screen's actions sit on the trailing edge, all on one row, with its status just before
 *   them, centred on the title and subtitle together (level with the title when there is none). The Page composer put Publish and Close under its description, on the left — a
 *   stylesheet rule said so on purpose — while the Controller Builder put the same buttons top-right.
 *   Both were hand-built `<header>`s inside one component. So: a `<header>` holding a button is
 *   built with ScreenHeader (components/ScreenHeader), which has one place for actions.
 *
 * P27 — One breadcrumb per page, and it is the shell's. The composers printed an eyebrow reading
 *   "Controller Builder / Compose" under the shell breadcrumb that already said exactly that. So:
 *   no element styled as an eyebrow spells a path, and antd's Breadcrumb is used by the two
 *   components whose job it is — the shell's, and the CR widget (which the portal lint holds to
 *   the same rule on the chart side).
 *
 * jsdom has no layout, so the geometry — trailing edge, centred, one row — is measured by
 * ui/visual/layout.spec.ts in a real browser. This checks the structure that makes it true.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const SCREEN_HEADER = join('components', 'ScreenHeader', 'ScreenHeader.tsx')
const BREADCRUMB_OWNERS = new Set([join('components', 'Breadcrumb', 'Breadcrumb.tsx'), join('widgets', 'Breadcrumb', 'Breadcrumb.tsx')])
const BUTTONS = new Set(['Button', 'button', 'HeaderIconButton'])
const CRUMB_TRAIL = /\S\s+\/\s+\S/

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { return walk(path) }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : []
  })

type Element = ts.JsxElement | ts.JsxSelfClosingElement
const tagOf = (node: Element) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText()
const attributesOf = (node: Element) => (ts.isJsxElement(node) ? node.openingElement : node).attributes

/** The literal text an element shows: its JSX text, string literals, template parts, and the value
 *  of a same-file constant it names (`const eyebrow = \`${label} / Compose\`` … `{eyebrow}`). */
const shownText = (node: ts.Node, constants: Map<string, ts.Expression>): string => {
  if (ts.isIdentifier(node) && constants.has(node.text)) { return shownText(constants.get(node.text)!, constants) }
  if (ts.isJsxText(node)) { return node.text }
  if (ts.isStringLiteralLike(node)) { return node.text }
  if (ts.isTemplateExpression(node)) { return [node.head.text, ...node.templateSpans.map((span) => `x${span.literal.text}`)].join('') }
  if (ts.isJsxAttributes(node)) { return '' }
  return node.getChildren().map((child) => shownText(child, constants)).join('')
}

const scan = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const at = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
  const hits: string[] = []
  const constants = new Map<string, ts.Expression>()
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isStringLiteralLike(node.initializer) || ts.isTemplateExpression(node.initializer))) {
      constants.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)

  if (!BREADCRUMB_OWNERS.has(file) && /import\s*\{[^}]*\bBreadcrumb\b[^}]*\}\s*from\s*'antd'/.test(text)) {
    hits.push(`${file}: imports antd's Breadcrumb — the shell renders the page's one breadcrumb (P27)`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && tagOf(node) === 'header' && file !== SCREEN_HEADER) {
      let hasButton = false
      const find = (child: ts.Node): void => {
        if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && BUTTONS.has(tagOf(child))) { hasButton = true }
        ts.forEachChild(child, find)
      }
      node.children.forEach(find)
      if (hasButton) { hits.push(`${at(node)} a hand-built <header> with actions — use ScreenHeader, which puts them on the trailing edge (P26)`) }
    }
    if (ts.isJsxElement(node)) {
      const className = attributesOf(node).properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className')
      if (className && /eyebrow/i.test(className.getText()) && CRUMB_TRAIL.test(node.children.map((child) => shownText(child, constants)).join(''))) {
        hits.push(`${at(node)} an eyebrow that spells a path — the shell breadcrumb already says it (P27)`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

describe('screen headers (P26, P27)', () => {
  it('no hand-built header holds actions, no eyebrow spells a path, and antd Breadcrumb stays with its owners', () => {
    const hits = walk(ROOT).flatMap((path) => scan(path.slice(ROOT.length + 1), readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })

  // A check that has stopped firing is worse than no check.
  it('fires on the shapes it claims to see, and stays silent on the ones it should', () => {
    const fixture = `
      import { Breadcrumb } from 'antd'
      const a = <header className={styles.head}><h1>t</h1><Space><Button>Publish</Button></Space></header>
      const b = <span className={styles.eyebrow}>{\`\${label} / Compose\`}</span>
      const c = <span className='eyebrow'>Builders / Compose</span>
      const crumb = \`\${spec.label} / Compose\`
      const g = <span className={styles.eyebrow}>{crumb}</span>
      // silent from here down
      const d = <header className={styles.head}><h1>t</h1><p>no actions</p></header>
      const e = <span className={styles.eyebrow}>Platform · tenant x</span>
      const f = <span className={styles.label}>a / b</span>
    `
    expect(scan('fixture.tsx', fixture).map((hit) => hit.replace(/^fixture\.tsx(:\d+)?:? ?/, ''))).toEqual([
      "imports antd's Breadcrumb — the shell renders the page's one breadcrumb (P27)",
      'a hand-built <header> with actions — use ScreenHeader, which puts them on the trailing edge (P26)',
      'an eyebrow that spells a path — the shell breadcrumb already says it (P27)',
      'an eyebrow that spells a path — the shell breadcrumb already says it (P27)',
      'an eyebrow that spells a path — the shell breadcrumb already says it (P27)',
    ])
  })
})
