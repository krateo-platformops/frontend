// @vitest-environment jsdom
/**
 * UI-NATIVE KOG BUILDER (item C) — component-level coverage of the "New RestDefinition" form's
 * build→publish WIRING. Proves the plain form reaches the IDENTICAL dispatch path Autopilot uses:
 *   - filling the URL-case fields and submitting dispatches EXACTLY ONE set through the REAL
 *     handleActionSet (the runRestSet → aggregated blast-radius confirm entry point), carrying the
 *     gitref + restdefinition-repocontent + pullrequest write paths — nothing is reimplemented;
 *   - a field-invalid submit surfaces the shared validator's errors INLINE and dispatches NOTHING.
 * The blast-radius confirm itself is owned by the reused runRestSet path (covered in
 * applyResourceSet.test.ts); here handleActionSet is mocked to a resolved success (human confirmed).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { WriteOp, WriteOpResult } from '../../hooks/runRestSet'

import { KogBuilderForm } from './KogBuilderForm'

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
    <KogBuilderForm onClose={vi.fn()} open />
  </App>,
)

const typeInto = (placeholder: RegExp, value: string) => {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } })
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

describe('KogBuilderForm — URL-case build→publish reaches the real dispatcher', () => {
  it('dispatches ONE git-write set through handleActionSet on submit', async () => {
    handleActionSet.mockClear()
    renderForm()

    typeInto(/mlflow-experiments/, 'mlflow-experiments')
    typeInto(/krateo-system/, 'krateo-system')
    typeInto(/mlflow\.example\.org/, 'local.mlflow.com')
    typeInto(/Experiment/, 'Experiment')
    typeInto(/openapi\.yaml/, 'https://raw.githubusercontent.com/x/mlflow/main/oas.yaml')
    // The default verb row is get/GET; fill its path (the only required verb field).
    typeInto(/\/api\/2\.0\/mlflow/, '/api/2.0/mlflow/experiments/get')

    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))

    await waitFor(() => expect(handleActionSet).toHaveBeenCalledTimes(1))
    const [ops] = handleActionSet.mock.calls[0] as [readonly WriteOp[]]
    // The exact reused KOG PR set: gitref, restdefinition repocontent, pullrequest.
    expect(ops).toHaveLength(3)
    expect(ops.map((op) => op.verb)).toEqual(['POST', 'POST', 'POST'])
    expect(ops.some((op) => op.path.includes('gitrefs'))).toBe(true)
    expect(ops.some((op) => op.path.includes('repocontents'))).toBe(true)
    expect(ops.some((op) => op.path.includes('pullrequests'))).toBe(true)
  })
})

describe('KogBuilderForm — validation gate', () => {
  it('a field-invalid submit surfaces inline errors and dispatches NOTHING', async () => {
    handleActionSet.mockClear()
    renderForm()

    // Only a name — missing resourceGroup / resourceKind / verb path / oasPath.
    typeInto(/mlflow-experiments/, 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))

    await waitFor(() => expect(screen.getByTestId('kog-builder-errors')).toBeTruthy())
    expect(handleActionSet).not.toHaveBeenCalled()
  })
})
