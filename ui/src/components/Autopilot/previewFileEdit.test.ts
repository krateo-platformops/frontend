// @vitest-environment jsdom
/**
 * FE-K(edit), page/blueprint half — the per-file preview-edit bus: the drawer→provider seam that
 * hands an accepted single-file edit back to the held draft + gate. A pure CustomEvent dispatch/
 * subscribe pair (mirrors previewEditBus.test.ts):
 *   - emitFileEdit delivers the {path, content} to a subscriber;
 *   - onFileEdit returns an unsubscribe that stops delivery (React effect cleanup);
 *   - a detail without a string path / string content is IGNORED (deny-by-default; never a crash).
 */
import { describe, expect, it, vi } from 'vitest'

import { AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, emitFileEdit, onFileEdit } from './previewFileEdit'

const edit = { content: 'kind: Flex\nmetadata:\n  name: root\n', path: 'flex.page-demo.yaml' }

describe('previewFileEdit', () => {
  it('delivers an emitted per-file edit to a subscriber', () => {
    const handler = vi.fn()
    const off = onFileEdit(handler)
    emitFileEdit(edit)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual(edit)
    off()
  })

  it('unsubscribe stops further delivery', () => {
    const handler = vi.fn()
    const off = onFileEdit(handler)
    off()
    emitFileEdit(edit)
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores an event whose detail lacks a string path or content (deny-by-default)', () => {
    const handler = vi.fn()
    const off = onFileEdit(handler)
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, { detail: { content: 'x', path: '' } }))
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, { detail: { content: 42, path: 'a.yaml' } }))
    window.dispatchEvent(new CustomEvent(AUTOPILOT_PREVIEW_FILE_EDIT_EVENT, { detail: undefined }))
    expect(handler).not.toHaveBeenCalled()
    off()
  })
})
