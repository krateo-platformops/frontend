// @vitest-environment jsdom
/**
 * UI-NATIVE PAGE BUILDER (item C) — component-level coverage of the "Import portal page" form's
 * import→build→publish WIRING. Proves the plain form reaches the IDENTICAL dispatch path Autopilot uses:
 *   - importing a page tree (a flex.page-<slug>.yaml root + a widget CR, via the paste path) and
 *     submitting dispatches EXACTLY ONE set through the REAL handleActionSet (the runRestSet →
 *     aggregated blast-radius confirm entry point), carrying the gitref + per-file repocontents +
 *     pullrequest write paths — nothing is reimplemented;
 *   - a tree with no page-<slug> root surfaces the inline denial and dispatches NOTHING.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import { PageBuilderForm } from './PageBuilderForm'

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
    <PageBuilderForm onClose={vi.fn()} open />
  </App>,
)

const addFile = (path: string, body: string) => {
  fireEvent.change(screen.getByPlaceholderText('flex.page-my-page.yaml'), { target: { value: path } })
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

describe('PageBuilderForm — import→publish reaches the real dispatcher', () => {
  it('dispatches ONE git-write set through handleActionSet on submit', async () => {
    handleActionSet.mockClear()
    renderForm()

    addFile('flex.page-cost-report.yaml', 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Flex\nmetadata:\n  name: page-cost-report\n')
    addFile('card.cost-summary.yaml', 'apiVersion: widgets.templates.krateo.io/v1beta1\nkind: Card\nmetadata:\n  name: cost-summary\n')

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

describe('PageBuilderForm — validation gate', () => {
  it('a tree with no page-<slug> root surfaces an inline denial and dispatches NOTHING', async () => {
    handleActionSet.mockClear()
    renderForm()

    addFile('card.cost-summary.yaml', 'kind: Card\nmetadata:\n  name: cost-summary\n')
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))

    await waitFor(() => expect(screen.getByTestId('page-builder-errors')).toBeTruthy())
    expect(handleActionSet).not.toHaveBeenCalled()
  })
})
