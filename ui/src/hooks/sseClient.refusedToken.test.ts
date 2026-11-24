/**
 * frontend#503, the cycle: a stream answered 401 raises the in-place sign-in and reopens on success. If the
 * reopen presents the SAME token and is refused again, asking again never ends: nothing the person does
 * changes the answer. A token seen refused is remembered until a stream opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetSseConnections, subscribeSse } from './signedInSseClient'

const auth = vi.hoisted(() => ({ token: 'tok-1' }))
const resume = vi.hoisted(() => ({ outcome: [] as ((outcome: string) => void)[] }))

vi.mock('../utils/sessionResume', () => ({
  raiseSessionExpired: () => new Promise<string>((settle) => { resume.outcome.push(settle) }),
}))
vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => auth.token, onAccessTokenInvalidated: () => () => undefined }))

const PAST_THE_FIRST_RETRY = 1300
let status = 401
let opened: { end: () => void; token: string }[] = []
let errors = 0

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let turn = 0; turn < 5; turn += 1) {
    // eslint-disable-next-line no-await-in-loop -- draining turns is inherently sequential
    await vi.advanceTimersByTimeAsync(0)
  }
}
const subscribe = async () => {
  subscribeSse('u', 't', { onError: () => { errors += 1 }, onMessage: () => undefined })
  await settle()
}
/** The sign-in answered, as the last raise asked. */
const signedIn = async (token = auth.token) => {
  auth.token = token
  resume.outcome.at(-1)?.('resumed')
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    let end: () => void = () => undefined
    const done = new Promise<{ done: true }>((resolve) => {
      end = () => { resolve({ done: true }) }
    })
    opened.push({ end, token: (init.headers as Record<string, string>).Authorization })
    return Promise.resolve({ body: { getReader: () => ({ read: () => done }) }, headers: new Headers(), ok: status === 200, status, statusText: '' })
  })
})
afterEach(() => {
  __resetSseConnections()
  status = 401
  auth.token = 'tok-1'
  opened = []
  errors = 0
  resume.outcome = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sseClient — a token already seen refused', () => {
  it('is not asked about again: the connection fails, and a later subscribe opens a fresh one', async () => {
    await subscribe()
    for (let round = 0; round < 4; round += 1) {
      // eslint-disable-next-line no-await-in-loop -- each round is a consequence of the last
      await signedIn()
    }
    expect(resume.outcome).toHaveLength(1)
    expect(opened).toHaveLength(2)
    expect(errors).toBe(2)
    status = 200
    await subscribe()
    expect(opened).toHaveLength(3)
  })

  it('a NEW token refused is its own expiry, and asks', async () => {
    await subscribe()
    await signedIn('tok-2')
    expect(opened.map(({ token }) => token)).toEqual(['Bearer tok-1', 'Bearer tok-2'])
    expect(resume.outcome).toHaveLength(2)
  })

  it('a token that then opens a stream may expire like any other', async () => {
    await subscribe()
    status = 200
    await signedIn()
    status = 401
    opened[1].end()
    await settle(PAST_THE_FIRST_RETRY)
    expect(opened).toHaveLength(3)
    expect(resume.outcome).toHaveLength(2)
  })
})
