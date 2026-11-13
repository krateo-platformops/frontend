import { describe, expect, it, vi } from 'vitest'

/**
 * Importing the signed-in SSE client (hooks/signedInSseClient.ts, the SSE client bound to the
 * stored session) must not touch the auth module's exports.
 *
 * `onAccessTokenInvalidated(reopenAll)` ran at module scope, so any suite that partially
 * mocked `getAccessToken` — a common thing to do, and nothing to do with SSE — failed to
 * COLLECT: vitest threw on the missing export, pointing at sseClient rather than at the
 * suite. `secretPayload`, `secretReview424` and `Notifications` ran ZERO tests for a day
 * that way, and the only visible symptom was a red `test` job on main (frontend#505).
 *
 * The mock below is deliberately incomplete — it is exactly the shape those three had.
 */
vi.mock('../utils/getAccessToken', () => ({ getAccessToken: () => 'tok' }))

describe('importing the signed-in SSE client', () => {
  it('needs nothing from the auth module but getAccessToken', async () => {
    const client = await import('./signedInSseClient')
    expect(typeof client.subscribeSse).toBe('function')
  })
})
