// @vitest-environment jsdom
/**
 * A caller that has already classified a failure passes its own `description`, and the
 * status-based defaults stay out of it. A caller that has not keeps exactly the old defaults.
 *
 * WHY. The sign-in callback classifies authn's refusal into copy that says what happened — and this
 * hook then appended "Please check your input or permissions." under every 4xx, on a page with no
 * input, and replaced a 500's classified text with "The server hit an unexpected error". The second
 * half of this file is the guard that the fix stayed narrow: every other page, which passes only a
 * status, must see no change at all.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'

import type { CatchError } from './useCatchError'
import useCatchError from './useCatchError'

let catchError: ReturnType<typeof useCatchError>['catchError'] = () => undefined

const Probe = () => {
  ({ catchError } = useCatchError())
  return null
}

const notify = async (error: CatchError) => {
  render(<App><Probe /></App>)
  act(() => { catchError(error, 'notification') })
  await waitFor(() => expect(document.querySelector('.ant-notification-notice')).not.toBeNull())
  return document.querySelector('.ant-notification-notice')?.textContent ?? ''
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('useCatchError — a caller-supplied description', () => {
  it('a 4xx with its own description shows it alone, without "Please check your input"', async () => {
    const text = await notify({
      description: 'Your account is not allowed into this control plane. (GroupNotAllowed)',
      message: 'Access not granted',
      status: 403,
    })
    expect(text).toMatch(/Access not granted/)
    expect(text).toMatch(/not allowed into this control plane/)
    expect(text).not.toMatch(/check your input/i)
  })

  it('a 500 with its own description keeps BOTH the message and the description it was given', async () => {
    // The 500 branch used to overwrite `message` too, so the classified title never reached the
    // notification at all.
    const text = await notify({
      description: 'Sign-in is unavailable: the platform could not check your credentials. (LDAPUnavailable)',
      message: 'Sign-in unavailable',
      status: 500,
    })
    expect(text).toMatch(/Sign-in unavailable/)
    expect(text).toMatch(/LDAPUnavailable/)
    expect(text).not.toMatch(/server hit an unexpected error/i)
    expect(text).not.toMatch(/unexpected condition/i)
  })
})

describe('useCatchError — callers that pass only a status are unchanged', () => {
  it('a bare 4xx still gets the default description', async () => {
    const text = await notify({ message: 'Could not save', status: 403 })
    expect(text).toMatch(/Could not save/)
    expect(screen.getByText('Please check your input or permissions.')).toBeTruthy()
  })

  it('a bare 500 still gets the server-error message and description', async () => {
    const text = await notify({ message: 'ignored', status: 500 })
    expect(text).toMatch(/The server hit an unexpected error/)
    expect(text).toMatch(/The server encountered an unexpected condition\./)
  })
})
