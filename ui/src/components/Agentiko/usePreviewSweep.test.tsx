// @vitest-environment jsdom
/** The sweep starts on a builder visit, with a sandbox and snowplow, and needs no router of its own. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { noteBuilderVisit, resetBuilderVisit } from '../../builders/builderVisit'
import type { Config } from '../../context/ConfigContext'

import { startPreviewSweep } from './previewSweep'
import { usePreviewSweep } from './usePreviewSweep'

vi.mock('./previewSweep', () => ({ startPreviewSweep: vi.fn() }))

const config = { api: { SNOWPLOW_API_BASE_URL: 'http://sp' } } as unknown as Config
const writer = { handleActionSet: vi.fn(), sandboxNamespace: 'krateo-preview' }
const held = () => 'gke'

beforeEach(() => { vi.mocked(startPreviewSweep).mockClear() })
afterEach(() => {
  cleanup()
  resetBuilderVisit()
})

describe('usePreviewSweep', () => {
  it('starts when a builder is visited, not before, with what the sweep needs', () => {
    renderHook(() => { usePreviewSweep(held, config, writer) })
    expect(startPreviewSweep).not.toHaveBeenCalled()
    act(() => { noteBuilderVisit() })
    expect(startPreviewSweep).toHaveBeenCalledExactlyOnceWith({ fetch: expect.any(Function) as unknown, heldPage: held, snowplowBaseUrl: 'http://sp', writer })
  })

  it('never starts without a sandbox, or without snowplow', () => {
    noteBuilderVisit()
    renderHook(() => { usePreviewSweep(held, config, undefined) })
    renderHook(() => { usePreviewSweep(held, undefined, writer) })
    expect(startPreviewSweep).not.toHaveBeenCalled()
  })
})
