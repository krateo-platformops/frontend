/**
 * The preview's "Publishes to" strip and the destination form must name the same repository.
 *
 * The strip read `portal` while the form beside it proposed `demo-pb-04`: a page set is its own
 * chart in its own repository (#163), named for the page, and publishDraft prefills exactly that.
 */
import { describe, expect, it } from 'vitest'

import { buildPagePreviewPayload, pagePublishRepo } from './previewBridge'

const pageRoot = (name: string) => ({
  apiVersion: 'widgets.templates.krateo.io/v1beta1',
  kind: 'Flex',
  metadata: { name, namespace: 'krateo-system' },
  spec: { widgetData: { items: [] } },
})

describe('the page publish strip', () => {
  it('names the page slug — the repository the destination form proposes — not portal', () => {
    expect(pagePublishRepo([pageRoot('page-demo-pb-04')])).toBe('demo-pb-04')
    expect(buildPagePreviewPayload([pageRoot('page-demo-pb-04')]).publishTarget).toEqual({ base: 'main', repo: 'demo-pb-04' })
  })

  it('promises no destination for a set with no page root — nothing can publish it', () => {
    const widgets = [{ kind: 'Table', metadata: { name: 'rows' } }]
    expect(pagePublishRepo(widgets)).toBeNull()
    expect(buildPagePreviewPayload(widgets).publishTarget).toBeUndefined()
  })
})
