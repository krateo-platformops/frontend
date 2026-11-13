/**
 * THE shared signed-in SSE client: one set of connections for the whole tab, authenticated with the
 * stored session's bearer.
 *
 * The only module that binds the SSE client (hooks/sseClient.ts, which imports no credential) to the
 * token getter. The widget tree never imports it: the signed-in transport (transport/
 * signedInTransport.tsx) hands its `subscribeSse` to everything below the shell as
 * `session.subscribeSse`, so the bell, a List's stream and an action's event wait share one socket —
 * and a public page, whose anonymous transport has no session, has no way to reach it.
 *
 * Each credential call goes through a lambda, read when it is CALLED: importing this module must not
 * touch the auth module (a suite that partially mocks `getAccessToken` would otherwise fail to
 * collect, frontend#505), and nothing is registered until the first subscription.
 */
import { getAccessToken, onAccessTokenInvalidated } from '../utils/getAccessToken'
import { raiseSessionExpired } from '../utils/sessionResume'

import { createSseClient } from './sseClient'

const client = createSseClient({
  getAccessToken: () => getAccessToken(),
  onAccessTokenInvalidated: (listener) => onAccessTokenInvalidated(listener),
  resume: () => raiseSessionExpired(),
})

export const { subscribeSse } = client

/** Test-only: abort + drop all connections. */
export const { __resetSseConnections } = client
