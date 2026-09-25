/**
 * One builder for "what a chart preview shows", for both callers — the agent's previewBlueprint verb
 * and the person's Preview in the composer. Two copies is how a drawer and a composer come to
 * disagree about the same draft.
 */
import { describe, expect, it } from 'vitest'

import { BLUEPRINT_PREVIEW_CAPTION, buildBlueprintPreviewPayload } from './blueprintPreviewPayload'

const files = {
  'Chart.yaml': 'apiVersion: v2\nname: orders-api\nversion: 0.1.0\n',
  'values.schema.json': '{"type":"object","properties":{"replicas":{"type":"integer","default":1}}}',
}

describe('buildBlueprintPreviewPayload', () => {
  it('a HELD draft is tagged blueprint and carries its tree, its own repo and its schema', () => {
    const payload = buildBlueprintPreviewPayload({ held: true, name: 'orders-api', rawTemplates: files, rendered: { objects: [] } })
    expect(payload.builder).toBe('blueprint')
    expect(payload.caption).toBe(BLUEPRINT_PREVIEW_CAPTION)
    expect(payload.filesLabel).toBe('Chart files')
    expect(payload.files?.map((file) => file.path)).toEqual(['Chart.yaml', 'values.schema.json'])
    // The chart's OWN repository — not the org, which used to be shown as if it were the repo.
    expect(payload.publishTarget?.repo).toBe('orders-api')
    expect(payload.formSchema).toBe(files['values.schema.json'])
    expect(payload.error).toBeUndefined()
    expect(payload.title).toBe('Blueprint preview — orders-api')
  })

  it('a draft that is not held is only looked at — the inspect tag, so nothing edits it', () => {
    expect(buildBlueprintPreviewPayload({ held: false, name: 'orders-api', rawTemplates: files, rendered: { error: 'boom', objects: [] } }))
      .toMatchObject({ builder: 'inspect', error: 'boom', objects: [] })
  })

  it('a published chart\'s dry run has no tree: no Chart files tab and no destination', () => {
    const payload = buildBlueprintPreviewPayload({ held: false, name: 'nginx', rendered: { objects: [], valuesSchema: { type: 'object' } } })
    expect(payload.files).toBeUndefined()
    expect(payload.publishTarget).toBeUndefined()
    expect(payload.formSchema).toBeDefined()
  })

  it('before any render, the tree still shows and Source is empty', () => {
    const payload = buildBlueprintPreviewPayload({ held: true, name: 'orders-api', rawTemplates: files })
    expect(payload.objects).toEqual([])
    expect(payload.files).toHaveLength(2)
  })
})
