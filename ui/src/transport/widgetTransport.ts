/**
 * How the widget tree reaches the backend — the ONE place a widget's request gets (or does not get)
 * a credential.
 *
 * WHY THIS EXISTS. Every widget path used to add `Authorization: Bearer ${getAccessToken()}` at its
 * own call site: the widget read, the Form's option fields, the Table's export, the Upload, the
 * List's event stream, the action dispatcher and everything it reaches. That made "this page is
 * public, send no token" impossible to state once: it would have had to be a flag every one of
 * those sites checked, and a site that forgot would have sent a stored token from a public page.
 * snowplow answers a stale or invalid token with 401 and never falls back to the public identity,
 * so a forgotten site is not merely a leak, it breaks the page.
 *
 * So the credential moved off the call sites and onto the transport. A call site asks the
 * transport in context to `fetch`, and never sees a token. Which transport is in context decides
 * everything:
 *
 *  - the SIGNED-IN transport (transport/signedInTransport.tsx) adds the bearer, raises the in-place
 *    session resume on a 401, and carries a `session` — the token getter and the SSE client — for
 *    the paths that only make sense signed in (writes, live streams). Only the signed-in shell
 *    (components/Shell) provides it.
 *  - the ANONYMOUS transport (public/anonymousTransport.ts) has no credential to add, refuses one if
 *    a caller passes it, and has no `session` at all. It is the context DEFAULT, so anything rendered
 *    outside the signed-in shell is anonymous by construction rather than by a check.
 *
 * This module imports nothing that can reach the token: it is only the shape and the context.
 */
import { createContext, useContext } from 'react'

// A TYPE import: erased at build, so it adds no runtime edge to the SSE client (or its token read).
import type { SseSubscriber } from '../hooks/sseClient'
import type { SessionResumeOutcome } from '../utils/sessionResume'
import { createAnonymousTransport } from '../public/anonymousTransport'

/**
 * The request options a transport accepts. Headers are a plain record so the signed-in transport
 * can merge its credential in and the anonymous one can inspect what it was handed.
 */
export type TransportInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

/** A request through the transport — the only way the widget tree reaches the backend. */
export type TransportFetch = (url: string, init?: TransportInit) => Promise<Response>

/**
 * What only a signed-in person has. Present on the signed-in transport, ABSENT on the anonymous
 * one — so a path that needs it (a write, a live stream) cannot run anonymously, because the thing
 * it would run with does not exist there.
 */
export interface SignedInSession {
  /** The stored session's token. Throws when none is stored, exactly as utils/getAccessToken does. */
  readonly getAccessToken: () => string
  /** The tab's shared signed-in SSE client (hooks/signedInSseClient.ts), which authenticates with the bearer. */
  readonly subscribeSse: (url: string, topic: string, subscriber: SseSubscriber) => () => void
  /** The in-place session resume (utils/sessionResume), for a channel that met a 401 and must know how it ended. */
  readonly resume: () => Promise<SessionResumeOutcome>
}

export interface WidgetTransport {
  /** Which transport this is. Diagnostic, and the cache partition (see PublicPage); never a gate. */
  readonly identity: 'signed-in' | 'anonymous'
  /** Every read the widget tree makes: GET /call, POST /call/read, POST /export, POST /jq. */
  readonly fetch: TransportFetch
  /**
   * Whether widgets may open live channels: the per-widget `/refreshes` stream, a List's event
   * stream, an action's event wait. True signed in; false on a public page, which renders what one
   * read returned and never connects a stream.
   */
  readonly live: boolean
  /**
   * Whether widgets may write: a snowplow `rest` action or action set, an upload, a provenance
   * AuditRecord. True signed in; false on a public page, where each of them sends nothing and says
   * "Sign in to do this" instead.
   */
  readonly writes: boolean
  /** A read answered 401. Signed in: the session resume. Anonymous: public serving is off here. */
  readonly onUnauthorized: (body: unknown) => void
  /** The signed-in session; absent on the anonymous transport. */
  readonly session?: SignedInSession
  /**
   * A plain same-origin JSON POST to an install-allowlisted path (config `PUBLIC_POST_PATHS`), for
   * a public page's form. NOT a snowplow /call write. Anonymous transport only.
   */
  readonly post?: (path: string, json: unknown) => Promise<Response>
}

/**
 * What a page without a signed-in session says when something on it would write — a snowplow
 * `rest` action, an action set, an upload. Nothing is sent; the person is told to sign in.
 */
export const SIGN_IN_TO_ACT = 'This page is open to visitors who are not signed in, and it cannot make changes for them. Sign in to do this.'

/**
 * The context DEFAULT is anonymous, with an empty POST allowlist and nothing listening for a 401.
 * Fail-closed: a widget rendered with no provider above it sends no credential.
 */
const DEFAULT_TRANSPORT: WidgetTransport = createAnonymousTransport()

const WidgetTransportContext = createContext<WidgetTransport>(DEFAULT_TRANSPORT)

export const WidgetTransportProvider = WidgetTransportContext.Provider

/** The transport in scope. Anonymous unless the signed-in shell (or a test) provided another. */
export const useWidgetTransport = (): WidgetTransport => useContext(WidgetTransportContext)
