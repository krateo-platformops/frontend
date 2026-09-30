// @vitest-environment jsdom
/**
 * THE ALIGNMENT GATE for the composer host (T4, frontend#410): each composer's DOM, state by state,
 * exactly as it was BEFORE the host was extracted.
 *
 * The snapshots in __snapshots__/composerStructure.test.tsx.snap were written against the
 * hand-built BlueprintComposer.tsx and PageComposer.tsx (main c85fb6f) and committed before either
 * was touched. After the extraction the same states must produce the same DOM: every element in
 * order, its classes, its ARIA, its inline style (the Page Composer's `--split`), each button's
 * label and state, the pills, and the Close draft confirm's words. Run WITHOUT `-u`; a diff here is
 * a visual change the host made, not a snapshot to refresh.
 *
 * WHAT IS NORMALISED, and why that loses nothing: element ids (React's useId and rc-* counters,
 * and the useId antd writes into its `css-var-…` class) become id1, id2… in first-seen order, and every attribute that REFERENCES an id is mapped through
 * the same table — so a reference that pointed at a different element would still show. The ids'
 * spelling depends on where a hook sits in the tree, which is exactly what an extraction moves.
 *
 * The pane widths are CSS (the palette's 200px, the side column's 300px); the class names above
 * pin which rules apply, and the rules themselves are read from the stylesheets at the end.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitDraftChanged } from '../../components/Autopilot/previewDraftChanged'
import { AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT, type DraftRenderRequestDetail } from '../../components/Autopilot/previewDraftRender'
import { AUTOPILOT_PUBLISH_REQUEST_EVENT, emitPublishResult, type PublishRequestDetail } from '../../components/Autopilot/previewPublishRequest'
import { graphDouble } from '../../components/DependencyGraph/flowGraphDouble'
import {
  answer,
  builderPublishChart,
  hold,
  installAntdShims,
  installScrollShim,
  listen,
  mountWithOwner,
  renderedPayload,
  seededChart,
} from '../../pages/BlueprintComposer/blueprintTestHarness'
import { emit, mount as mountPage, widgetCr } from '../../pages/PageComposer/composerTestHarness'

vi.mock('@ant-design/graphs', () => import('../../components/DependencyGraph/flowGraphDouble'))
vi.mock('@antv/g6-extension-react', () => ({ ReactNode: vi.fn() }))

beforeAll(() => {
  installAntdShims()
  installScrollShim()
})
beforeEach(() => graphDouble.reset())
afterEach(() => {
  cleanup()
  act(() => emitDraftChanged({ files: {}, kind: null }))
})

/** A React useId spelling inside another value — antd's `css-var-_r_k_` class carries one. */
const REACT_ID = /_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g

const ID_ATTRS = new Set(['id', 'for', 'aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'data-node-key'])

/** The element tree as indented lines: tag, attributes (ids normalised), and trimmed text. */
const outline = (root: Element): string => {
  const ids = new Map<string, string>()
  const idOf = (raw: string): string => raw.split(/\s+/).filter(Boolean).map((one) => {
    if (!ids.has(one)) { ids.set(one, `id${ids.size + 1}`) }
    return ids.get(one) as string
  })
    .join(' ')
  const lines: string[] = []
  const walk = (node: Node, depth: number) => {
    const pad = '  '.repeat(depth)
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) { lines.push(`${pad}"${text}"`) }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { return }
    const element = node as Element
    const attrs = [...element.attributes]
      .map((attr) => ({ name: attr.name, value: ID_ATTRS.has(attr.name) ? idOf(attr.value) : attr.value.replace(REACT_ID, (raw) => idOf(raw)) }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, value }) => `${name}="${value}"`)
    lines.push(`${pad}<${element.tagName.toLowerCase()}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`)
    element.childNodes.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  return lines.join('\n')
}

/** Just the composer: the container's one child. */
const page = (container: HTMLElement) => outline(container.firstElementChild as Element)

/** The Close draft confirm, opened, as the person reads it — then closed again. */
const closeConfirm = (): string => {
  act(() => { screen.getByRole('button', { name: 'Close draft' }).click() })
  const popover = document.querySelector('.ant-popconfirm') as HTMLElement
  const words = [popover.querySelector('.ant-popconfirm-title')?.textContent, ...[...popover.querySelectorAll('button')].map((button) => button.textContent)]
  act(() => { screen.getByRole('button', { name: 'Keep editing' }).click() })
  return words.join(' | ')
}

describe('Blueprint Composer — DOM structure, unchanged by the host', () => {
  it('empty: nothing held', () => {
    const { container } = mountWithOwner()
    expect(page(container)).toMatchSnapshot()
  })

  it('parked: a page draft is held', () => {
    const { container } = mountWithOwner()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'x', 'templates/flex.page-x.yaml': 'kind: Flex' }, kind: 'page' }))
    expect(page(container)).toMatchSnapshot()
  })

  it('own: a fresh chart, preview needed, Publish off with its reason', () => {
    const { container } = mountWithOwner()
    hold(seededChart(), { previewed: false })
    expect(page(container)).toMatchSnapshot()
    expect(closeConfirm()).toMatchSnapshot()
  })

  it('own: a chart with lint problems', () => {
    const { container } = mountWithOwner()
    hold(builderPublishChart(), { previewed: false, problems: ['Chart.yaml: version is not semver', 'values.schema.json: no root'] })
    expect(page(container)).toMatchSnapshot()
  })

  it('own: previewing, then rendered — Publish on — then published', () => {
    const renders = listen<DraftRenderRequestDetail>(AUTOPILOT_DRAFT_RENDER_REQUEST_EVENT)
    const publishes = listen<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT)
    const { container } = mountWithOwner()
    const files = seededChart()
    hold(files, { previewed: false })
    act(() => { screen.getByRole('button', { name: 'Preview' }).click() })
    expect(page(container)).toMatchSnapshot('previewing')
    answer({ id: renders.seen[0].id, message: null, outcome: 'rendered', payload: renderedPayload(files, [{ kind: 'ConfigMap', name: 'x', yaml: 'kind: ConfigMap\n' }]) })
    hold(files, { previewed: true })
    expect(page(container)).toMatchSnapshot('rendered')
    act(() => { screen.getByRole('button', { name: 'Publish' }).click() })
    expect(page(container)).toMatchSnapshot('publishing')
    act(() => emitPublishResult({ deepLink: 'https://scm.example/pr/1', denial: null, id: publishes.seen[0].id }))
    expect(page(container)).toMatchSnapshot('published')
    renders.stop()
    publishes.stop()
  })
})

describe('Page Composer — DOM structure, unchanged by the host', () => {
  it('empty: nothing held', () => {
    const { container } = mountPage()
    expect(page(container)).toMatchSnapshot()
  })

  it('parked: a blueprint draft is held', () => {
    const { container } = mountPage()
    act(() => emitDraftChanged({ files: { 'Chart.yaml': 'apiVersion: v2\nname: nginx-demo\n' }, kind: 'blueprint' }))
    expect(page(container)).toMatchSnapshot()
  })

  it('own: a page held — header actions, split, tree', () => {
    const { container } = mountPage()
    emit({ files: [{ content: widgetCr('Flex', 'page-x', ['card-a']), path: 'flex.page-x.yaml' }, { content: widgetCr('Panel', 'card-a'), path: 'panel.card-a.yaml' }], title: 'x' })
    expect(page(container)).toMatchSnapshot()
    expect(closeConfirm()).toMatchSnapshot()
  })

  it('own: publishing, then a denial', () => {
    const publishes = listen<PublishRequestDetail>(AUTOPILOT_PUBLISH_REQUEST_EVENT)
    const { container } = mountPage()
    emit({ files: [{ content: widgetCr('Flex', 'page-x'), path: 'flex.page-x.yaml' }], title: 'x' })
    act(() => { screen.getByRole('button', { name: 'Publish' }).click() })
    expect(page(container)).toMatchSnapshot('publishing')
    act(() => emitPublishResult({ deepLink: null, denial: 'Not published — preview the page first.', id: publishes.seen[0].id }))
    expect(page(container)).toMatchSnapshot('denied')
    publishes.stop()
  })
})

describe('the pane widths the frame classes carry', () => {
  const rule = (file: string, selector: string): string => {
    const css = readFileSync(join(__dirname, '..', '..', 'pages', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1].split(',').map((part) => part.trim()).includes(selector))
      .map((match) => match[2].replace(/\s+/g, ' ').trim())
      .join(' | ')
  }

  it('Blueprint: palette 200px, side 300px', () => {
    expect(rule('BlueprintComposer/BlueprintComposer.module.css', '.palettePane')).toMatch(/flex: 0 0 200px/)
    expect(rule('BlueprintComposer/BlueprintComposer.module.css', '.side')).toMatchSnapshot()
    expect(rule('BlueprintComposer/BlueprintComposer.module.css', '.body')).toMatchSnapshot()
  })

  it('Page: palette, centre split, structure column', () => {
    for (const selector of ['.build', '.palette', '.centre', '.result', '.structure']) {
      expect(rule('PageComposer/PageComposer.module.css', selector), selector).toMatchSnapshot(selector)
    }
  })
})
