/**
 * C26 — BUTTON ROLES, in the app's own code. A button says what it does to the work in front of you:
 *
 *   - DISMISS (closes, backs out, deletes nothing — Cancel, Close, Close draft, Keep editing) is
 *     amber: `DismissButton`, or `dismissButtonProps` where antd builds the button itself;
 *   - DESTROY (deletes content — Discard, Remove, Delete) is red: antd's `danger`.
 *
 * What it checks, from the TypeScript AST:
 *   - a `<Button>` whose text is a dismiss label is a `DismissButton` instead (or spreads
 *     `dismissButtonProps`); one whose text is a destroy label carries `danger`;
 *   - every `<Popconfirm>` and every `<Modal>` that draws antd's own Cancel button passes
 *     `cancelButtonProps` — antd draws that button whether or not `cancelText` names it; a Modal
 *     with its own `footer` draws none, and is judged through the Buttons inside it;
 *   - a `<Popconfirm>` or `<Modal>` whose `okText` is a destroy label passes `okButtonProps` with
 *     `danger` (or `okType='danger'`);
 *   - the same two for an object handed to `modal.confirm(…)`, read where it is built.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
export const DISMISS = /^(cancel|close|close draft|close and \w+|dismiss|keep editing|keep it|keep|back)$/i
export const DESTROY = /^(discard|delete|remove|destroy|uninstall)\b/i

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { return walk(path) }
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : []
  })

type Element = ts.JsxElement | ts.JsxSelfClosingElement
const opening = (node: Element) => (ts.isJsxElement(node) ? node.openingElement : node)
const tagOf = (node: Element) => opening(node).tagName.getText()
const attribute = (node: Element, name: string) =>
  opening(node).attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name) as ts.JsxAttribute | undefined
const spreads = (node: Element, name: string) =>
  opening(node).attributes.properties.some((prop) => ts.isJsxSpreadAttribute(prop) && prop.expression.getText() === name)
/** A string attribute's literal value, or '' when it is computed. */
const literal = (attr?: ts.JsxAttribute | ts.PropertyAssignment) => {
  const init = attr && (ts.isJsxAttribute(attr) ? attr.initializer : attr.initializer)
  if (!init) { return '' }
  if (ts.isStringLiteral(init)) { return init.text }
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) { return init.expression.text }
  return ''
}
const textOf = (node: ts.JsxElement) => node.children.map((child) => (ts.isJsxText(child) ? child.text : '')).join('').replace(/\s+/g, ' ')
  .trim()
const isFalse = (attr?: ts.JsxAttribute) => !!attr?.initializer && attr.initializer.getText().replace(/[{}\s]/g, '') === 'false'
const hasDanger = (text = '') => /\bdanger\b/.test(text)

export const scan = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const at = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
  const hits: string[] = []
  // Only antd's own Button, Popconfirm and Modal: the app has a `Modal` of its own (the widget
  // host), and a fixture with no imports is read as antd.
  const fromAntd = new Set<string>()
  source.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'antd') {
      const named = statement.importClause?.namedBindings
      if (named && ts.isNamedImports(named)) { named.elements.forEach((element) => fromAntd.add(element.name.text)) }
    }
  })
  const hasImports = source.statements.some(ts.isImportDeclaration)
  const isAntd = (tag: string) => !hasImports || fromAntd.has(tag)

  const visit = (node: ts.Node): void => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && isAntd(tagOf(node))) {
      const tag = tagOf(node)
      if (tag === 'Button' && ts.isJsxElement(node)) {
        const label = textOf(node)
        if (DISMISS.test(label) && !spreads(node, 'dismissButtonProps')) {
          hits.push(`${at(node)} "${label}" dismisses — use DismissButton (C26)`)
        }
        if (DESTROY.test(label) && !attribute(node, 'danger')) {
          hits.push(`${at(node)} "${label}" deletes — give it \`danger\` (C26)`)
        }
      }
      if (tag === 'Popconfirm' || tag === 'Modal') {
        const drawsCancel = tag === 'Popconfirm' ? !isFalse(attribute(node, 'showCancel')) : !attribute(node, 'footer')
        if (drawsCancel && !attribute(node, 'cancelButtonProps')) {
          hits.push(`${at(node)} ${tag}'s Cancel button — pass cancelButtonProps={dismissButtonProps} (C26)`)
        }
        const ok = literal(attribute(node, 'okText'))
        if (DESTROY.test(ok) && !hasDanger(attribute(node, 'okButtonProps')?.getText()) && literal(attribute(node, 'okType')) !== 'danger') {
          hits.push(`${at(node)} ${tag}'s "${ok}" deletes — okButtonProps={{ danger: true }} (C26)`)
        }
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(node.properties.filter(ts.isPropertyAssignment).map((prop) => [prop.name.getText(), prop]))
      const names = new Set(node.properties.map((prop) => prop.name?.getText() ?? ''))
      // A modal.confirm config: it names onOk, onCancel and a content or title; antd draws its Cancel.
      if (names.has('onOk') && names.has('onCancel') && (names.has('content') || names.has('title')) && !names.has('cancelButtonProps')) {
        hits.push(`${at(node)} a confirm dialog's Cancel button — pass cancelButtonProps: dismissButtonProps (C26)`)
      }
      if (names.has('onOk') && DESTROY.test(literal(props.get('okText'))) && !hasDanger(props.get('okButtonProps')?.getText()) && literal(props.get('okType')) !== 'danger') {
        hits.push(`${at(node)} a confirm dialog's "${literal(props.get('okText'))}" deletes — okButtonProps: { danger: true } (C26)`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hits
}

describe('button roles (C26)', () => {
  it('dismiss buttons are amber and destroy buttons are red, everywhere the app draws one', () => {
    const hits = walk(ROOT).flatMap((path) => scan(path.slice(ROOT.length + 1), readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })

  // A check that has stopped firing is worse than no check.
  it('fires on the shapes it claims to see, and stays silent on the ones it should', () => {
    const fixture = `
      const a = <Button onClick={x}>Cancel</Button>
      const b = <Button>Close draft</Button>
      const c = <Button size='small'>Remove Kind</Button>
      const d = <Popconfirm okText='Discard' onConfirm={x} title='t'><Button danger>Discard draft</Button></Popconfirm>
      const e = <Modal okText='Start' open title='t' />
      const f = modal.confirm({ content: c, onCancel, onOk, title: 't' })
      // silent from here down
      const g = <DismissButton>Cancel</DismissButton>
      const h = <Button {...dismissButtonProps}>Close</Button>
      const i = <Button danger>Delete</Button>
      const j = <Popconfirm cancelButtonProps={dismissButtonProps} okButtonProps={{ danger: true }} okText='Remove' title='t'><span /></Popconfirm>
      const k = <Modal footer={null} open title='t' />
      const l = <Popconfirm showCancel={false} title='t'><span /></Popconfirm>
      const m = <Button type='primary'>Publish</Button>
      const n = modal.confirm({ cancelButtonProps: dismissButtonProps, content: c, onCancel: x, onOk: y })
    `
    expect(scan('fixture.tsx', fixture).map((hit) => hit.replace(/^fixture\.tsx:\d+ /, ''))).toEqual([
      '"Cancel" dismisses — use DismissButton (C26)',
      '"Close draft" dismisses — use DismissButton (C26)',
      '"Remove Kind" deletes — give it `danger` (C26)',
      "Popconfirm's Cancel button — pass cancelButtonProps={dismissButtonProps} (C26)",
      "Popconfirm's \"Discard\" deletes — okButtonProps={{ danger: true }} (C26)",
      "Modal's Cancel button — pass cancelButtonProps={dismissButtonProps} (C26)",
      'a confirm dialog\'s Cancel button — pass cancelButtonProps: dismissButtonProps (C26)',
    ])
  })
})
