// @vitest-environment jsdom
/**
 * UI-NATIVE BLUEPRINT BUILDER (item C) — component-level coverage of the "Import blueprint" form's
 * import→build→publish WIRING. Proves the plain form reaches the IDENTICAL dispatch path Autopilot uses:
 *   - importing a chart tree (Chart.yaml + a template, via the paste path) and submitting dispatches
 *     EXACTLY ONE set through the REAL handleActionSet (the runRestSet → aggregated blast-radius confirm
 *     entry point), carrying the gitref + per-file repocontents + pullrequest write paths — nothing is
 *     reimplemented;
 *   - a tree with NO Chart.yaml surfaces the inline denial and dispatches NOTHING.
 * The blast-radius confirm itself is owned by the reused runRestSet path (covered in
 * applyResourceSet.test.ts); here handleActionSet is mocked to a resolved success (human confirmed).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import { BlueprintBuilderForm } from './BlueprintBuilderForm'

const handleActionSet = vi.fn((_ops: readonly WriteOp[]): Promise<WriteOpResult[] | null> =>
  Promise.resolve([{ ok: true, status: 201 } as unknown as WriteOpResult]))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: vi.fn(), handleActionSet, isActionLoading: false }),
}))

vi.mock('../../context/ConfigContext', () => ({
  useConfigContext: () => ({ config: { api: {}, params: {} }, isLoading: false }),
}))

const renderForm = () => render(
  <App>
    <BlueprintBuilderForm onClose={vi.fn()} open />
  </App>,
)

/** Add a file through the paste path (path input + body + "Add file"). */
const addFile = (path: string, body: string) => {
  fireEvent.change(screen.getByPlaceholderText('Chart.yaml'), { target: { value: path } })
  fireEvent.change(screen.getByPlaceholderText('…or paste a file body here'), { target: { value: body } })
  fireEvent.click(screen.getByRole('button', { name: 'Add file' }))
}

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      addEventListener: noop,
      addListener: noop,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: noop,
      removeListener: noop,
    }),
    writable: true,
  })
  globalThis.ResizeObserver = class { disconnect = noop; observe = noop; unobserve = noop } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
})

describe('BlueprintBuilderForm — import→publish reaches the real dispatcher', () => {
  it('dispatches ONE git-write set through handleActionSet on submit', async () => {
    handleActionSet.mockClear()
    renderForm()

    addFile('Chart.yaml', 'apiVersion: v2\nname: my-blueprint\nversion: 0.1.0\n')
    addFile('templates/deployment.yaml', 'apiVersion: apps/v1\nkind: Deployment\n')

    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))

    await waitFor(() => expect(handleActionSet).toHaveBeenCalledTimes(1))
    const [ops] = handleActionSet.mock.calls[0] as [readonly WriteOp[]]
    // gitref + 2 repocontents (one per file) + pullrequest.
    expect(ops).toHaveLength(4)
    expect(ops.every((op) => op.verb === 'POST')).toBe(true)
    expect(ops.some((op) => op.path.includes('gitrefs'))).toBe(true)
    expect(ops.filter((op) => op.path.includes('repocontents'))).toHaveLength(2)
    expect(ops.some((op) => op.path.includes('pullrequests'))).toBe(true)
  })
})

describe('BlueprintBuilderForm — validation gate', () => {
  it('a tree with no Chart.yaml surfaces an inline denial and dispatches NOTHING', async () => {
    handleActionSet.mockClear()
    renderForm()

    addFile('templates/deployment.yaml', 'apiVersion: apps/v1\nkind: Deployment\n')
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))

    await waitFor(() => expect(screen.getByTestId('blueprint-builder-errors')).toBeTruthy())
    expect(handleActionSet).not.toHaveBeenCalled()
  })
})
