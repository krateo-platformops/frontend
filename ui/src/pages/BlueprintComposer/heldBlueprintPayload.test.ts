/**
 * What the composer puts under its canvas — the held chart and its last render — and how it words
 * a Preview's answer. Pure.
 */
import { describe, expect, it } from 'vitest'

import { BLUEPRINT_PREVIEW_CAPTION } from '../../components/Autopilot/blueprintPreviewPayload'

import {
  FAILED_RENDER_CAPTION,
  STALE_RENDER_CAPTION,
  UNRENDERED_CAPTION,
  heldBlueprintPayload,
  lastRenderOf,
  renderCaption,
  sameFiles,
} from './heldBlueprintPayload'
import { STALE_OUTCOME, renderOutcomeCopy } from './renderOutcome'
import { startChart } from './startChart'

const started = startChart({ description: '', name: 'builder-publish', version: '0.1.0' })
const files = started.ok ? started.files : {}
const OBJECT = { kind: 'ConfigMap', name: 'builder-publish-architecture', yaml: 'kind: ConfigMap\n' }

describe('heldBlueprintPayload', () => {
  it('is nothing with nothing held', () => {
    expect(heldBlueprintPayload({}, null)).toBeNull()
  })

  it('is the HELD chart — editable, named from Chart.yaml — with its files under "Chart files"', () => {
    const payload = heldBlueprintPayload(files, null)
    expect(payload?.builder).toBe('blueprint')
    expect(payload?.title).toBe('Blueprint preview — builder-publish')
    expect(payload?.filesLabel).toBe('Chart files')
    expect(payload?.files?.map((file) => file.path).sort()).toEqual(Object.keys(files).sort())
    expect(payload?.objects).toEqual([])
    expect(payload?.liveEndpoint).toBeUndefined()
  })

  it('carries NO create form — the inspector shows it, beside the graph', () => {
    const schema = JSON.stringify({ properties: { replicas: { type: 'integer' } }, type: 'object' })
    expect(heldBlueprintPayload({ ...files, 'values.schema.json': schema }, null)).not.toHaveProperty('formSchema')
  })

  it('carries the last render\'s objects, or its error', () => {
    expect(heldBlueprintPayload(files, { objects: [OBJECT] })?.objects).toEqual([OBJECT])
    expect(heldBlueprintPayload(files, { error: 'template: bad', objects: [] })?.error).toBe('template: bad')
  })
})

describe('the Source caption, measured against the files the render was OF', () => {
  it('before any preview: what the tabs are, and that Source fills on Preview', () => {
    expect(renderCaption(files, null)).toBe(UNRENDERED_CAPTION)
  })

  it('a render of exactly these files: the builder\'s own caption', () => {
    const render = lastRenderOf({ files: Object.entries(files).map(([path, content]) => ({ content, path })), objects: [OBJECT] })
    expect(renderCaption(files, render)).toBeUndefined()
    expect(heldBlueprintPayload(files, render, renderCaption(files, render))?.caption).toBe(BLUEPRINT_PREVIEW_CAPTION)
  })

  it('files changed since: old, and said so', () => {
    const render = lastRenderOf({ files: [{ content: 'x', path: 'Chart.yaml' }], objects: [OBJECT] })
    expect(renderCaption(files, render)).toBe(STALE_RENDER_CAPTION)
  })

  it('a failed render of these very files is a failure, not "changed since"', () => {
    const render = lastRenderOf({ error: 'boom', files: Object.entries(files).map(([path, content]) => ({ content, path })), objects: [] })
    expect(renderCaption(files, render)).toBe(FAILED_RENDER_CAPTION)
  })

  it('sameFiles: same paths, same bytes', () => {
    expect(sameFiles({ a: '1' }, { a: '1' })).toBe(true)
    expect(sameFiles({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameFiles({ a: '1' }, { a: '1', b: '' })).toBe(false)
  })
})

describe('renderOutcomeCopy — the answer, in the person\'s words', () => {
  it('rendered counts the objects', () => {
    expect(renderOutcomeCopy({ id: 'x', message: null, outcome: 'rendered', payload: { objects: [OBJECT, OBJECT], title: 't' } }))
      .toEqual({ title: 'Rendered 2 objects — read them in Source. Publish is on until the chart changes.', type: 'success' })
  })

  it('failed points at Source; refused lists the problems; stale is the same sentence everywhere', () => {
    expect(renderOutcomeCopy({ id: 'x', message: 'It did not render.', outcome: 'failed' }).title).toBe('It did not render. The render error is in Source.')
    expect(renderOutcomeCopy({ id: 'x', message: 'Fix these.', outcome: 'refused', problems: ['a', 'b'] })).toEqual({ lines: ['a', 'b'], title: 'Fix these.', type: 'warning' })
    expect(renderOutcomeCopy({ id: 'x', message: 'provider wording', outcome: 'stale' })).toEqual({ title: STALE_OUTCOME, type: 'info' })
    expect(renderOutcomeCopy({ id: 'x', message: 'No render here.', outcome: 'unavailable' })).toEqual({ title: 'No render here.', type: 'warning' })
  })
})
