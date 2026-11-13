// @vitest-environment jsdom
/**
 * `submitPost`: a Form that POSTs JSON to an allow-listed same-origin path through the transport's
 * `post`, and maps each response to a Result, field errors or an inline Alert — never a toast.
 * Driven with the two request-access pages' widgetData (checkPostFixtures.ts), plus `fieldHelp`
 * and the one-submit-mode rule.
 */
import { library } from '@fortawesome/fontawesome-svg-core'
import { fas } from '@fortawesome/free-solid-svg-icons'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { FragmentExtrasProvider } from '../../context/PageRootContext'
import { createAnonymousTransport } from '../../public/anonymousTransport'
import { SignedInTransportProvider } from '../../transport/signedInTransport'
import { type WidgetTransport, WidgetTransportProvider } from '../../transport/widgetTransport'

import { CONFIRM_FORM, INTAKE, REQUEST_FORM } from './checkPostFixtures'
import Form, { type FormWidgetData } from './Form'

const spies = vi.hoisted(() => ({
  handleAction: { calls: 0 },
  navigate: [] as string[],
  notified: [] as unknown[],
}))

vi.mock('../../hooks/useHandleActions', () => ({
  useHandleAction: () => ({ handleAction: () => { spies.handleAction.calls += 1; return Promise.resolve() }, isActionLoading: false }),
}))
vi.mock('antd/es/app/useApp', () => {
  const record = (...args: unknown[]) => { spies.notified.push(args) }
  return { default: () => ({ message: {}, modal: {}, notification: { error: record, info: record, success: record, warning: record } }) }
})
vi.mock('../../components/Agentiko/agentDraft', () => ({ useAgentDraft: () => ({ draft: null, nonce: 1 }) }))
vi.mock('../Drawer/DrawerContext', () => ({ useDrawerContext: () => ({ insideDrawer: false, setDrawerData: () => undefined }) }))
vi.mock('react-router', () => ({ useNavigate: () => (to: string) => { spies.navigate.push(to) } }))
// The signed-in transport, for the "no token on a signed-in page either" case: a synthetic token.
vi.mock('../../utils/getAccessToken', () => ({
  getAccessToken: () => 'SYNTHETIC-TOKEN',
  invalidateAccessTokenCache: () => undefined,
  onAccessTokenInvalidated: () => () => undefined,
}))
vi.mock('../../context/ConfigContext', () => ({ useConfigContext: () => ({ config: { api: { PUBLIC_POST_PATHS: INTAKE } } }) }))

// The app registers the icon packs at startup (App.tsx); a Result's `icon` names one of them.
library.add(fas)

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()

const reply = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers }, status })))

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
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  spies.handleAction.calls = 0
  spies.navigate = []
  spies.notified = []
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const anonymous = (allowlist = [INTAKE]) => createAnonymousTransport({ postAllowlist: allowlist })

const renderForm = (widgetData: FormWidgetData, { extras = {}, transport = anonymous() }: { extras?: Record<string, string>; transport?: WidgetTransport } = {}) => render(
  <WidgetTransportProvider value={transport}>
    <FragmentExtrasProvider value={extras}>
      <Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={widgetData} />
    </FragmentExtrasProvider>
  </WidgetTransportProvider>,
)

const LINK = { s: 'SUB-123', t: 'TOK-456' }
/** Screen 2 without its live check, so a submit is the only request. */
const CONFIRM: FormWidgetData = { ...CONFIRM_FORM, fieldChecks: undefined, initialValues: { username: 'jane-doe' } }
const REQUEST: FormWidgetData = {
  ...REQUEST_FORM,
  initialValues: { company: 'Example Corp', consentProcessing: true, country: 'IT', email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe', useCase: 'Try it.' },
}

const submit = (label: string) => { fireEvent.click(screen.getByText(label)) }
const confirm = () => { submit('Confirm and send request') }

const errorUnder = (container: HTMLElement, label: string) => {
  const item = [...container.querySelectorAll('.ant-form-item')].find((each) => each.querySelector('label')?.textContent?.includes(label))
  return item?.querySelector('.ant-form-item-explain-error')?.textContent
}

describe('submitPost: what is sent', () => {
  it('POSTs the values plus the link\'s s/t in the BODY, to exactly the path, with no credential', async () => {
    reply(200, { status: 'filed', username: 'jane-doe' })
    renderForm(CONFIRM, { extras: LINK })
    confirm()
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${INTAKE}confirmations`)
    expect(url).not.toMatch(/SUB-123|TOK-456/)
    expect(JSON.parse(init.body as string)).toEqual({ submission: 'SUB-123', token: 'TOK-456', username: 'jane-doe' })
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(Object.keys(init.headers as Record<string, string>).map((name) => name.toLowerCase())).not.toContain('authorization')
    expect(spies.handleAction.calls).toBe(0)
  })

  it('on a SIGNED-IN page the same post carries no token either', async () => {
    reply(200, { status: 'filed', username: 'jane-doe' })
    render(
      <SignedInTransportProvider>
        <FragmentExtrasProvider value={LINK}>
          <Form resourcesRefs={{ items: [] } as never} uid='u' widgetData={CONFIRM} />
        </FragmentExtrasProvider>
      </SignedInTransportProvider>,
    )
    confirm()
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.stringify(init)).not.toContain('SYNTHETIC-TOKEN')
    expect(init.credentials).toBe('omit')
  })

  it('a page extra wins over a field of the same name', async () => {
    reply(202, { status: 'received' })
    const withTokenField: FormWidgetData = {
      initialValues: { token: 'typed' },
      stringSchema: JSON.stringify({ properties: { token: { type: 'string' } }, type: 'object' }),
      submitPost: { bodyExtras: { token: 't' }, path: `${INTAKE}x` },
    }
    renderForm(withTokenField, { extras: LINK })
    submit('Submit')
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ token: 'TOK-456' })
  })

  it('a path off the allowlist is refused unsent, and the form says it cannot submit', async () => {
    renderForm(CONFIRM, { extras: LINK, transport: anonymous([]) })
    confirm()
    expect(await screen.findByText('This form is not configured to submit.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('while in flight the form is disabled and the button loading; a second click sends nothing', async () => {
    let answer: (response: Response) => void = () => undefined
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve }))
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    await waitFor(() => { expect(container.querySelector('.ant-btn-loading')).not.toBeNull() })
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('jane-doe')
    confirm()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { answer(new Response(JSON.stringify({ status: 'retry' }), { status: 200 })) })
    await waitFor(() => { expect(container.querySelector('.ant-btn-loading')).toBeNull() })
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(false)
  })
})

describe('submitPost: the confirmation page', () => {
  it('filed: a success Result replaces the form, with the echoed username as TEXT', async () => {
    reply(200, { status: 'filed', username: '<b>jane</b>' })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    expect(await screen.findByText('Thanks — your request is with an administrator.')).toBeTruthy()
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('.ant-result-success')).not.toBeNull()
    expect(container.querySelector('.ant-result-subtitle')?.textContent).toBe("Your username will be <b>jane</b>. We'll email you when it's approved.")
    expect(container.querySelector('.ant-result b')).toBeNull()
  })

  it('unavailable: a field error, the link still works, no alert', async () => {
    reply(200, { status: 'unavailable' })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    await waitFor(() => { expect(errorUnder(container, 'Username')).toBe('That username is taken. Try another.') })
    expect(container.querySelector('.ant-alert')).toBeNull()
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('expired: the expired Result, whose button goes back to the request form', async () => {
    reply(200, { status: 'expired' })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    expect(await screen.findByText('This link has expired or was already used.')).toBeTruthy()
    const button = within(container.querySelector('.ant-result-extra') as HTMLElement).getByText('Request access again').closest('a') as HTMLAnchorElement
    expect(button.getAttribute('href')).toBe('/public/request-access')
    fireEvent.click(button)
    expect(spies.navigate).toEqual(['/public/request-access'])
  })

  it('limit: the used-up Result, with the sign-in line and no button', async () => {
    reply(200, { status: 'limit' })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    expect(await screen.findByText('This link has used up its tries')).toBeTruthy()
    expect(container.querySelector('.ant-result-subtitle')?.textContent).toBe('You tried 3 usernames that were already taken. You can request access again tomorrow, once this link has expired.')
    const extra = container.querySelector('.ant-result-extra') as HTMLElement
    expect(extra.textContent).toBe('Already have an account? Sign in')
    expect(extra.querySelector('.ant-btn')).toBeNull()
    expect(within(extra).getByText('Sign in').closest('a')?.getAttribute('href')).toBe('/login')
  })

  it.each([
    ['length', 'Use 3 to 56 characters.'],
    ['charset', 'Use only lowercase letters, digits and dashes.'],
    ['dns-label', 'Start and end with a letter or a digit.'],
    ['reserved', 'That name is reserved.'],
    ['something-new', 'Check this username.'],
  ])('400 rule %s: "%s" on the field', async (rule, message) => {
    reply(400, { error: 'invalid', fields: ['username'], rule })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    await waitFor(() => { expect(errorUnder(container, 'Username')).toBe(message) })
  })

  it('429: an inline warning Alert above the button, no toast, no countdown', async () => {
    reply(429, undefined)
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.classList.contains('ant-alert-warning')).toBe(true)
    expect(alert.textContent).toContain('Too many requests right now')
    expect(alert.textContent).toContain('Wait a moment and try again. Your username is still here.')
    // above the action bar: the Alert is followed by the buttons, not preceded by them
    expect(alert.nextElementSibling?.textContent).toContain('Confirm and send request')
    expect(spies.notified).toEqual([])
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('jane-doe')
  })

  it.each([
    ['30', 'Try again in 30 seconds. Your username is still here.'],
    ['150', 'Try again in 3 minutes. Your username is still here.'],
    ['Wed, 21 Oct 2026 07:28:00 GMT', 'Wait a moment and try again. Your username is still here.'],
  ])('429 with Retry-After %s: "%s", stated once', async (retryAfter, description) => {
    reply(429, undefined, { 'Retry-After': retryAfter })
    renderForm(CONFIRM, { extras: LINK })
    confirm()
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.querySelector('.ant-alert-description')?.textContent).toBe(description)
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 1100) }) })
    expect(alert.querySelector('.ant-alert-description')?.textContent).toBe(description)
  })

  it.each([
    ['retry', () => reply(200, { status: 'retry' })],
    ['503', () => reply(503, { error: 'unavailable' })],
    ['a network error', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])('%s: `otherwise`, the retry warning', async (_name, arrange) => {
    arrange()
    renderForm(CONFIRM, { extras: LINK })
    confirm()
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.classList.contains('ant-alert-warning')).toBe(true)
    expect(alert.textContent).toContain("We couldn't send your request just now")
    expect(spies.notified).toEqual([])
  })

  it('the Alert is cleared when the next submit starts', async () => {
    reply(429, undefined)
    reply(200, { status: 'unavailable' })
    const { container } = renderForm(CONFIRM, { extras: LINK })
    confirm()
    await screen.findByRole('alert')
    confirm()
    await waitFor(() => { expect(errorUnder(container, 'Username')).toBe('That username is taken. Try another.') })
    expect(container.querySelector('.ant-alert')).toBeNull()
  })
})

describe('submitPost: the request page', () => {
  it('202: the "Check your inbox" Result, with its icon', async () => {
    reply(202, { status: 'received' })
    const { container } = renderForm(REQUEST)
    submit('Request access')
    expect(await screen.findByText('Check your inbox')).toBeTruthy()
    expect(container.querySelector('.ant-result-info .ant-result-icon svg')).not.toBeNull()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ consentProcessing: true, country: 'IT', email: 'jane@example.com' })
  })

  it('400: each named field gets its own message; an unknown name is ignored', async () => {
    reply(400, { error: 'invalid', fields: ['email', 'company', 'nonsense'] })
    const { container } = renderForm(REQUEST)
    submit('Request access')
    await waitFor(() => { expect(errorUnder(container, 'Email')).toBe('Enter a valid email address, like jane@example.com.') })
    expect(errorUnder(container, 'Company')).toBe('Enter your company.')
    expect(container.querySelector('.ant-alert')).toBeNull()
  })

  it('400 naming no field of the form: its message as an error Alert', async () => {
    reply(400, { error: 'invalid', fields: ['nonsense'] })
    renderForm(REQUEST)
    submit('Request access')
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.classList.contains('ant-alert-error')).toBe(true)
    expect(alert.textContent).toContain('Check this field.')
  })

  it('429 with Retry-After: the approved copy, without "from your network"', async () => {
    reply(429, undefined, { 'Retry-After': '30' })
    renderForm(REQUEST)
    submit('Request access')
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.querySelector('.ant-alert-description')?.textContent).toBe("We've had too many requests in a short time. Try again in 30 seconds.")
  })

  it('anything else: the error Alert, nothing typed lost', async () => {
    reply(500, { error: 'boom' })
    const { container } = renderForm(REQUEST)
    submit('Request access')
    const alert = (await screen.findByRole('alert')).closest('.ant-alert') as HTMLElement
    expect(alert.classList.contains('ant-alert-error')).toBe(true)
    expect(alert.textContent).toContain("We couldn't send your request")
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('Jane')
  })
})

describe('fieldHelp', () => {
  it('renders under the input as antd `extra`, and only where the CR gives one', () => {
    const { container } = renderForm(REQUEST)
    const items = [...container.querySelectorAll('.ant-form-item')]
    const phone = items.find((each) => each.querySelector('label')?.textContent?.includes('Phone')) as HTMLElement
    const extra = phone.querySelector('.ant-form-item-extra') as HTMLElement
    expect(extra.textContent).toBe('Start with + and your country code. Spaces are fine.')
    // under the control: the extra follows the input in the document
    expect(phone.querySelector('input')?.compareDocumentPosition(extra)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    const email = items.find((each) => each.querySelector('label')?.textContent?.includes('Email')) as HTMLElement
    expect(email.querySelector('.ant-form-item-extra')).toBeNull()
  })
})

describe('one way to submit', () => {
  const SCHEMA = JSON.stringify({ properties: { a: { type: 'string' } }, type: 'object' })
  const ACTIONS = { rest: [{ headers: [], id: 'submit', resourceRefId: 'ref', type: 'rest' as const }] }

  it.each([
    ['neither', { stringSchema: SCHEMA }, 'no way to submit'],
    ['both', { actions: ACTIONS, stringSchema: SCHEMA, submitActionId: 'submit', submitPost: { path: `${INTAKE}x` } }, 'two ways to submit'],
    ['actions without submitActionId', { actions: ACTIONS, stringSchema: SCHEMA }, 'no `submitActionId`'],
    ['submitActionId without actions', { stringSchema: SCHEMA, submitActionId: 'submit' }, 'no `actions`'],
  ])('%s: the error state names the problem', (_name, widgetData, problem) => {
    const { container } = renderForm(widgetData as FormWidgetData)
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('.ant-result-error')?.textContent).toContain(problem)
  })

  it('actions + submitActionId (every existing CR) renders the form', () => {
    const { container } = renderForm({ actions: ACTIONS, stringSchema: SCHEMA, submitActionId: 'submit' })
    expect(container.querySelector('form')).not.toBeNull()
  })
})
