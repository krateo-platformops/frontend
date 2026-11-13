/**
 * The ANONYMOUS widget transport: what a page rendered outside the signed-in shell reads with.
 *
 * snowplow (snowplow#1334) serves a request carrying NO Authorization header as the identity
 * `krateo:public`, and its answer is the authority: 200 means the public identity may read that
 * widget, 401 means public serving is off on this install, 403 means it was not granted. A stale or
 * invalid token is a 401 and never falls back to public — so a public page must never send one,
 * not even the one sitting in storage from an earlier sign-in.
 *
 * THE GUARANTEE IS STRUCTURAL. This module imports nothing that can reach the stored token
 * (utils/getAccessToken, the session resume, the SSE client): a test walks its import graph and
 * fails the moment such an edge appears (anonymousTransport.graph.test.ts), and eslint refuses
 * those imports under src/public. On top of that it builds every request's headers itself, sends
 * `credentials: 'omit'` so no cookie rides along either, and throws on an Authorization header a
 * caller hands it — a caller that tries is a bug, and failing loudly is how it gets found.
 *
 * It has no `session`, so nothing that needs one — a snowplow write, an upload, a live stream, an
 * audit record — can run on it. Its only write is `post`: a plain same-origin JSON POST to a path
 * the install allowlisted, for a public form (it is not a /call write). The signed-in transport
 * carries the same `post`, token-less there too (transport/allowlistedPost.ts).
 */
import { createAllowlistedPost } from '../transport/allowlistedPost'
import type { TransportInit, TransportFetch, WidgetTransport } from '../transport/widgetTransport'

// The allow-listed post is shared with the signed-in transport; its pieces stay importable from
// here, where #717 put them.
export { checkPublicPost, parsePublicPostPaths, PublicPostRefused } from '../transport/allowlistedPost'

/** Thrown, synchronously, when a caller hands the anonymous transport a credential. */
export class AnonymousCredentialError extends Error {
  constructor() {
    super('The anonymous transport never sends an Authorization header; a caller passed one.')
    this.name = 'AnonymousCredentialError'
  }
}

const hasAuthorization = (headers: Record<string, string> | undefined): boolean =>
  !!headers && Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')

/**
 * A read with no credential. The headers are copied, never shared, and `credentials: 'omit'` is
 * set last so a caller cannot turn cookies back on.
 */
export const anonymousFetch: TransportFetch = (url: string, init: TransportInit = {}) => {
  if (hasAuthorization(init.headers)) {
    throw new AnonymousCredentialError()
  }
  return fetch(url, { ...init, credentials: 'omit', headers: { ...init.headers } })
}

export interface AnonymousTransportOptions {
  /** The parsed `PUBLIC_POST_PATHS`. Empty (the default): every `post` is refused. */
  postAllowlist?: readonly string[]
  /** A read answered 401: public serving is off on this install. */
  onUnauthorized?: (body: unknown) => void
}

export const createAnonymousTransport = ({ onUnauthorized, postAllowlist = [] }: AnonymousTransportOptions = {}): WidgetTransport => ({
  fetch: anonymousFetch,
  identity: 'anonymous',
  live: false,
  onUnauthorized: (body: unknown) => { onUnauthorized?.(body) },
  post: createAllowlistedPost(postAllowlist),
  writes: false,
})
