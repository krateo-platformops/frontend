// @vitest-environment jsdom
/**
 * `fieldChecks`: a field checked against an allow-listed endpoint while it is typed — after typing
 * pauses and on blur, a newer value aborting the check in flight, a slow answer for an old value
 * never landing, a client timeout — and each answer as the field's antd validation. Driven with
 * the confirmation page's widgetData (checkPostFixtures.ts) and fake timers.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { FragmentExtrasProvider } from '../../context/PageRootContext'
import { createAnonymousTransport } from '../../public/anonymousTransport'
import { WidgetTransportProvider } from '../../transport/widgetTransport'

import { CONFIRM_FORM, INTAKE } from './checkPostFixtures'
import Form, { type FormWidgetData } from './Form'

vi.mock('../../hooks/useHandleActions', () => ({ useHandleAction: () => ({ handleAction: () => Promise.resolve(), isActionLoading: false }) }))
vi.mock('antd/es/app/useApp', () => ({ default: () => ({ message: {}, modal: {}, notification: { error: () => undefined, info: () => undefined, success: () => undefined } }) }))
vi.mock('../../components/Agentiko/agentDraft', () => ({ useAgentDraft: () => ({ draft: null, nonce: 1 }) }))
vi.mock('../Drawer/DrawerContext', () => ({ useDrawerContext: () => ({ insideDrawer: false, setDrawerData: () => undefined }) }))
vi.mock('react-router', () => ({ useNavigate: () => () => undefined }))

interface Sent {
  url: string
  init: RequestInit
  body: Record<string, unknown>
  answer: (status: number, body?: unknown, headers?: Record<string, string>) => Promise<void>
}

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

/**
 * antd shows a field's message through a chain of deferred updates (a debounce, then the list's
 * motion), each scheduled only once the one before it has rendered. One act() runs one link of it,
 * so let several go by.
 */
async function settle() {
  for (let round = 0; round < 6; round += 1) {
    // eslint-disable-next-line no-await-in-loop -- each round must render before the next is scheduled
    await flush(50)
  }
}

let sent: Sent[] = []
/** When false, a request ignores its abort signal, like a server answer already on its way. */
let honourAbort = true

const fetchMock = vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
  if (honourAbort) {
    init.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
  }
  sent.push({
    answer: async (status, body, headers = {}) => {
      resolve(new Response(body === undefined ? null : JSON.stringify(body), { headers, status }))
      await settle()
    },
    body: JSON.parse(init.body as string) as Record<string, unknown>,
    init,
    url,
  })
}))

beforeAll(() => {
  const noop = () => undefined
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ addEventListener: noop, addListener: noop, dispatchEvent: () => false, matches: false, media: query, onchange: null, removeEventListener: noop, removeListener: noop }),
    writable: true,
  })
  globalThis.ResizeObserver = class {
    disconnect = noop
    observe = noop
    unobserve = noop
  }
})
beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  honourAbort = true
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const LINK = { s: 'SUB-123', t: 'TOK-456' }

const renderForm = (widgetData: FormWidgetData = CONFIRM_FORM) => {
  const view = render(
    <WidgetTransportProvider value={createAnonymousTransport({ postAllowlist: [INTAKE] })}>
      <FragmentExtrasProvider value={LINK}>
        <Form resourcesRefs={{ items: [] }} uid='u' widgetData={widgetData} />
      </FragmentExtrasProvider>
    </WidgetTransportProvider>,
  )
  const input = () => view.container.querySelector('input') as HTMLInputElement
  const item = () => view.container.querySelector('.ant-form-item') as HTMLElement
  return {
    ...view,
    blur: async () => { fireEvent.focusOut(input()); await flush() },
    input,
    item,
    message: () => item().querySelector('.ant-form-item-explain')?.textContent ?? '',
    type: async (value: string) => { fireEvent.change(input(), { target: { value } }); await flush() },
  }
}

const checks = () => sent.filter((each) => each.url.endsWith('/username-checks'))
const submits = () => sent.filter((each) => each.url.endsWith('/confirmations'))

describe('when a check is sent', () => {
  it('after typing pauses for 500 ms, with the value and the link in the body', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(499)
    expect(checks()).toHaveLength(0)
    await flush(1)
    expect(checks()).toHaveLength(1)
    expect(checks()[0].url).toBe(`${INTAKE}username-checks`)
    expect(checks()[0].body).toEqual({ submission: 'SUB-123', token: 'TOK-456', username: 'jane-doe' })
    expect(checks()[0].init.credentials).toBe('omit')
    expect(Object.keys(checks()[0].init.headers as Record<string, string>).map((name) => name.toLowerCase())).not.toContain('authorization')
  })

  it('a keystroke restarts the pause', async () => {
    const form = renderForm()
    await form.type('ja')
    await flush(300)
    await form.type('jan')
    await flush(300)
    expect(checks()).toHaveLength(0)
    await flush(200)
    expect(checks().map((each) => each.body.username)).toEqual(['jan'])
  })

  it('blur sends at once', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await form.blur()
    expect(checks()).toHaveLength(1)
    await flush(1000)
    expect(checks()).toHaveLength(1)
  })

  it('a CR debounce is honoured', async () => {
    const form = renderForm({ ...CONFIRM_FORM, fieldChecks: [{ ...CONFIRM_FORM.fieldChecks![0], debounceMs: 1200 }] })
    await form.type('jane-doe')
    await flush(1199)
    expect(checks()).toHaveLength(0)
    await flush(1)
    expect(checks()).toHaveLength(1)
  })

  it('never for an empty value, nor one failing the field\'s own rules', async () => {
    const strict = { ...CONFIRM_FORM, stringSchema: JSON.stringify({ properties: { username: { minLength: 3, title: 'Username', type: 'string' } }, required: ['username'], type: 'object' }) }
    const form = renderForm(strict)
    await form.type('ab')
    await flush(600)
    await form.blur()
    await form.type('')
    await flush(600)
    expect(checks()).toHaveLength(0)
  })
})

describe('a newer value wins', () => {
  it('typing aborts the check in flight, and the new value is checked', async () => {
    const form = renderForm()
    await form.type('jane')
    await flush(500)
    const [first] = checks()
    expect(first.init.signal?.aborted).toBe(false)
    await form.type('janet')
    expect(first.init.signal?.aborted).toBe(true)
    await flush(500)
    expect(checks().map((each) => each.body.username)).toEqual(['jane', 'janet'])
  })

  it('a slow answer for an old value never lands on the new one', async () => {
    honourAbort = false
    const form = renderForm()
    await form.type('jane')
    await flush(500)
    await form.type('janet')
    await flush(500)
    await checks()[1].answer(200, { status: 'unavailable' })
    expect(form.message()).toBe('That username is taken. Try another.')
    // the answer for "jane" arrives last; it must change nothing
    await checks()[0].answer(200, { status: 'available' })
    expect(form.message()).toBe('That username is taken. Try another.')
    expect(form.item().classList.contains('ant-form-item-has-error')).toBe(true)
    expect(form.item().classList.contains('ant-form-item-has-success')).toBe(false)
  })

  it('a value with a definitive answer is not checked again', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(200, { status: 'available' })
    await form.type('other')
    await flush(500)
    await form.type('jane-doe')
    await flush(600)
    await form.blur()
    expect(checks().map((each) => each.body.username)).toEqual(['jane-doe', 'other'])
    expect(form.message()).toBe('jane-doe is available.')
  })
})

describe('the timeout', () => {
  it('after 10 s by default the request is aborted and `otherwise` shows', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await flush(9_999)
    expect(checks()[0].init.signal?.aborted).toBe(false)
    await flush(1)
    expect(checks()[0].init.signal?.aborted).toBe(true)
    await settle()
    expect(form.message()).toBe("We couldn't check that name right now.")
    expect(form.item().classList.contains('ant-form-item-has-warning')).toBe(true)
  })

  it('a CR timeout is honoured', async () => {
    const form = renderForm({ ...CONFIRM_FORM, fieldChecks: [{ ...CONFIRM_FORM.fieldChecks![0], timeoutMs: 3000 }] })
    await form.type('jane-doe')
    await flush(500)
    await flush(3000)
    await settle()
    expect(form.message()).toBe("We couldn't check that name right now.")
  })
})

describe('each answer as the field\'s validation', () => {
  it('while checking, antd\'s validating state', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    expect(form.item().classList.contains('ant-form-item-is-validating')).toBe(true)
  })

  it.each([
    ['available', 200, { status: 'available' }, {}, 'success', 'jane-doe is available.'],
    ['unavailable', 200, { status: 'unavailable' }, {}, 'error', 'That username is taken. Try another.'],
    ['limit', 200, { status: 'limit' }, {}, 'warning', "You've used up this link's availability checks. You can still submit; if the name is taken we'll tell you."],
    ['retry', 200, { status: 'retry' }, {}, 'warning', "We couldn't check that name right now."],
    ['400 length', 400, { fields: ['username'], rule: 'length' }, {}, 'error', 'Use 3 to 56 characters.'],
    ['400 charset', 400, { fields: ['username'], rule: 'charset' }, {}, 'error', 'Use only lowercase letters, digits and dashes.'],
    ['400 dns-label', 400, { fields: ['username'], rule: 'dns-label' }, {}, 'error', 'Start and end with a letter or a digit.'],
    ['400 reserved', 400, { fields: ['username'], rule: 'reserved' }, {}, 'error', 'That name is reserved.'],
    ['429', 429, undefined, {}, 'warning', 'Too many requests right now. Wait a moment and try again.'],
    ['429 with Retry-After 30', 429, undefined, { 'Retry-After': '30' }, 'warning', 'Too many requests right now. Try again in 30 seconds.'],
    ['429 with Retry-After 61', 429, undefined, { 'Retry-After': '61' }, 'warning', 'Too many requests right now. Try again in 2 minutes.'],
    ['503', 503, { error: 'holds' }, {}, 'warning', "We couldn't check that name right now."],
  ])('%s → %s', async (_name, status, body, headers, validateStatus, message) => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(status, body, headers)
    expect(form.item().classList.contains(`ant-form-item-has-${validateStatus}`)).toBe(true)
    expect(form.message()).toBe(message)
    // the help text stays under the input whatever shows
    expect(form.item().querySelector('.ant-form-item-extra')?.textContent).toBe("Lowercase letters, digits and dashes, 3–56 characters. You'll sign in with it.")
  })

  it('expired: the expired Result replaces the form, as a submit would', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(200, { status: 'expired' })
    expect(form.container.querySelector('form')).toBeNull()
    expect(form.container.querySelector('.ant-result-title')?.textContent).toBe('This link has expired or was already used.')
    expect(form.container.querySelector('.ant-result-extra')?.textContent).toBe('Request access again')
  })

  it('a warning answer is checked again on the next blur', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(200, { status: 'retry' })
    await form.blur()
    expect(checks()).toHaveLength(2)
    await checks()[1].answer(200, { status: 'available' })
    expect(form.message()).toBe('jane-doe is available.')
  })
})

describe('the check and the submit', () => {
  it('an error answer blocks submitting', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(200, { status: 'unavailable' })
    fireEvent.click(form.getByText('Confirm and send request'))
    await flush(100)
    expect(submits()).toHaveLength(0)
    expect(checks()).toHaveLength(1)
  })

  it('a warning answer (the link\'s checks used up) does not', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    await checks()[0].answer(200, { status: 'limit' })
    fireEvent.click(form.getByText('Confirm and send request'))
    await flush(100)
    expect(submits()).toHaveLength(1)
    expect(submits()[0].body).toEqual({ submission: 'SUB-123', token: 'TOK-456', username: 'jane-doe' })
  })

  it('a submit during a check waits for its answer and starts no second check', async () => {
    const form = renderForm()
    await form.type('jane-doe')
    await flush(500)
    fireEvent.click(form.getByText('Confirm and send request'))
    await flush(100)
    expect(submits()).toHaveLength(0)
    await checks()[0].answer(200, { status: 'available' })
    await flush(100)
    expect(checks()).toHaveLength(1)
    expect(submits()).toHaveLength(1)
  })
})
