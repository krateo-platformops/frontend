/**
 * The URL-fragment reader, as pure functions: parse what a page was opened with, pick the keys the
 * page declares, and say what the address bar should keep.
 *
 * A page declares the fragment keys it reads with an annotation on its ROOT widget,
 *
 *     metadata:
 *       annotations:
 *         krateo.io/fragment-keys: "s,t"
 *
 * and opening `/x#s=…&t=…` hands `s` and `t` to that page's widgets as extras. An annotation and not
 * a spec field because every widget CRD is strict (a new field is a CRD change for each kind), and
 * because it is a fact about the page, like the `krateo.io/nav-*` annotations the navigation reads.
 *
 * Why a FRAGMENT: it is the one part of a URL the browser never sends anywhere. A share link's
 * inputs ride in it so they reach no server log — and so this reader, which then clears them from
 * the address bar, is also what keeps them out of the history the link landed in. For the same
 * reason they never go into a request URL either: a widget whose extras include them reads through
 * POST /call/read, with the extras in the body (hooks/useWidgetQuery.ts).
 */
import type { Widget } from '../types/Widget'

/** The annotation a page root declares its fragment keys with. */
export const FRAGMENT_KEYS_ANNOTATION = 'krateo.io/fragment-keys'

/** A key a page may declare: plain identifier characters, nothing a URL or jq would interpret. */
const KEY_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/

/** What a page was opened with: the `key=value` pairs of its fragment, decoded. */
export interface CapturedFragment {
  readonly pairs: ReadonlyMap<string, string>
}

export const EMPTY_FRAGMENT: CapturedFragment = Object.freeze({ pairs: new Map<string, string>() })

/** The frozen "no fragment extras" value — one object, so "nothing" never re-keys a query. */
export const EMPTY_FRAGMENT_EXTRAS: Readonly<Record<string, string>> = Object.freeze({})

/**
 * Percent-decoding only. `+` is NOT a space here: that is a query-string convention, and a fragment
 * value is often a token whose alphabet includes `+` (base64), which turning into a space would
 * silently corrupt.
 */
const decode = (text: string): string | null => {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

/** The decoded key of one `&`-separated part, or null when the part is not a `key=value` pair. */
const keyOf = (part: string): string | null => {
  const at = part.indexOf('=')
  if (at <= 0) { return null }
  return decode(part.slice(0, at))
}

/** Parse `#a=1&b=2&anchor` → {a: '1', b: '2'}. Parts that are not pairs (an anchor) are ignored. */
export const parseFragment = (hash: string): CapturedFragment => {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) { return EMPTY_FRAGMENT }
  const pairs = new Map<string, string>()
  for (const part of raw.split('&')) {
    const key = keyOf(part)
    if (key === null) { continue }
    const value = decode(part.slice(part.indexOf('=') + 1))
    if (value !== null) { pairs.set(key, value) }
  }
  return pairs.size ? { pairs } : EMPTY_FRAGMENT
}

/** The keys a root widget declares (its `krateo.io/fragment-keys` annotation), well-formed only. */
export const fragmentKeysOf = (widget: Widget | undefined): string[] => {
  const annotations = (widget?.metadata as { annotations?: Record<string, unknown> } | undefined)?.annotations
  const declared = annotations?.[FRAGMENT_KEYS_ANNOTATION]
  if (typeof declared !== 'string') { return [] }
  return declared.split(',').map((key) => key.trim()).filter((key) => KEY_SHAPE.test(key))
}

/** The declared keys' values from what was captured. A key the page did not declare is never passed. */
export const pickFragment = (fragment: CapturedFragment, keys: readonly string[]): Readonly<Record<string, string>> => {
  const picked: Record<string, string> = {}
  for (const key of keys) {
    const value = fragment.pairs.get(key)
    if (value !== undefined) { picked[key] = value }
  }
  return Object.keys(picked).length ? picked : EMPTY_FRAGMENT_EXTRAS
}

/**
 * The fragment with `keys` removed, as raw text without the `#` — every other part (an anchor, a
 * pair the page does not read) kept byte for byte. `keys === 'all'` removes everything.
 */
export const fragmentWithout = (hash: string, keys: ReadonlySet<string> | 'all'): string => {
  if (keys === 'all') { return '' }
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return raw.split('&').filter((part) => {
    const key = keyOf(part)
    return part !== '' && !(key !== null && keys.has(key))
  }).join('&')
}

/**
 * Take the given keys (or the whole fragment) out of the address bar, in place.
 *
 * `history.replaceState` rewrites the CURRENT entry, so the link's inputs do not survive in the
 * history it landed in, and no entry is added. `history.state` is passed through untouched because
 * the router keeps its own bookkeeping there. A no-op when there is nothing to remove, so a page
 * opened without a fragment never touches history at all.
 */
export const clearFragment = (keys: ReadonlySet<string> | 'all'): void => {
  if (typeof window === 'undefined') { return }
  const { hash, pathname, search } = window.location
  if (!hash) { return }
  const rest = fragmentWithout(hash, keys)
  const next = `${pathname}${search}${rest ? `#${rest}` : ''}`
  if (next === `${pathname}${search}${hash}`) { return }
  window.history.replaceState(window.history.state, '', next)
}
