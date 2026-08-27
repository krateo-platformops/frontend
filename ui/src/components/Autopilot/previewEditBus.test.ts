// @vitest-environment jsdom
/**
 * FE-K(edit) — the preview-edit bus: the drawer→provider seam that hands an accepted edited
 * RestDefinition draft back to the preview gate. A pure CustomEvent dispatch/subscribe pair.
 *   - emitRestDefEdit delivers the draft to a subscriber;
 *   - onRestDefEdit returns an unsubscribe that stops delivery (React effect cleanup);
 *   - a detail without a draft object is IGNORED (deny-by-default; never a crash).
 */
import { describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_EDIT_EVENT, emitRestDefEdit, onRestDefEdit } from './previewEditBus'

const draft = { apiVersion: 'ogen.krateo.io/v1alpha1', kind: 'RestDefinition', metadata: { name: 'gh-repo' } }

describe('previewEditBus', () => {
  it('delivers an emitted draft to a subscriber', () => {
    const handler = vi.fn()
    const off = onRestDefEdit(handler)
    emitRestDefEdit(draft)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ draft })
    off()
  })

  it('unsubscribe stops further delivery', () => {
    const handler = vi.fn()
    const off = onRestDefEdit(handler)
    off()
    emitRestDefEdit(draft)
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores an event whose detail carries no draft object (deny-by-default)', () => {
    const handler = vi.fn()
    const off = onRestDefEdit(handler)
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EDIT_EVENT, { detail: { draft: undefined } }))
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_EDIT_EVENT, { detail: { draft: 'not-an-object' } }))
    expect(handler).not.toHaveBeenCalled()
    off()
  })
})
