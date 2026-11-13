/**
 * The page ROOT — the one widget a routed page opens with — and what hangs off it.
 *
 * A page (WidgetPage in the shell, PublicPage outside it) wraps its root WidgetRenderer in
 * `PageRootProvider`. That renderer recognises itself by its endpoint, reports how its read ended,
 * and provides its descendants the page's FRAGMENT EXTRAS: the URL-fragment keys the root declares
 * (`krateo.io/fragment-keys`, see context/pageFragment.ts), with the values the page was opened
 * with. It then clears the PageRoot context for everything below it, so a descendant is never taken
 * for the root — not even one that names the same endpoint, which would be a cycle anyway.
 *
 * The root itself does not receive the fragment extras: they are declared ON it, so they are known
 * only once its read has answered. Its descendants get them on their first read, because the root
 * provides them in the same render it first draws its children with.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react'

import type { Widget } from '../types/Widget'

import { type CapturedFragment, clearFragment, EMPTY_FRAGMENT_EXTRAS, fragmentKeysOf, parseFragment } from './pageFragment'

export interface PageRoot {
  /** The root widget's endpoint — how its renderer recognises itself. */
  readonly endpoint: string
  /** The fragment the page was opened with, captured when the page mounted. */
  readonly fragment: CapturedFragment
  /** The root's read answered with a widget. */
  readonly resolved: (widget: Widget) => void
  /** The root's read failed for good (after its retries), with the HTTP status when there was one. */
  readonly failed: (status: number | undefined) => void
}

const PageRootContext = createContext<PageRoot | null>(null)

/** The page root in scope, or null — below the root (it clears this) and outside any page. */
export const usePageRoot = (): PageRoot | null => useContext(PageRootContext)

/** Provides `null`: the root renderer wraps its descendants in this so none of them is the root. */
export const PageRootReset = ({ children }: { children: ReactNode }) => (
  <PageRootContext.Provider value={null}>{children}</PageRootContext.Provider>
)

const FragmentExtrasContext = createContext<Readonly<Record<string, string>>>(EMPTY_FRAGMENT_EXTRAS)

/** The page's fragment extras for this widget. Empty (the frozen singleton) almost everywhere. */
export const useFragmentExtras = (): Readonly<Record<string, string>> => useContext(FragmentExtrasContext)

export const FragmentExtrasProvider = FragmentExtrasContext.Provider

export const PageRootProvider = ({ children, endpoint, onFailed }: {
  children: ReactNode
  endpoint: string
  /** Told when the root read fails for good — the public page turns a 403 into its own state. */
  onFailed?: (status: number | undefined) => void
}) => {
  // Captured ONCE, when the page mounts (pages are keyed by path, so each page captures its own),
  // and before anything has had the chance to clear it.
  const [fragment] = useState(() => parseFragment(typeof window === 'undefined' ? '' : window.location.hash))
  const settled = useRef(false)
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  const resolved = useCallback((widget: Widget) => {
    if (settled.current) { return }
    settled.current = true
    // Only the keys the page declared leave the address bar; anything else in the fragment (an
    // anchor, a pair the page does not read) is not this reader's and stays.
    const keys = fragmentKeysOf(widget)
    if (fragment.pairs.size && keys.length) { clearFragment(new Set(keys)) }
  }, [fragment])

  const failed = useCallback((status: number | undefined) => {
    onFailedRef.current?.(status)
    if (settled.current) { return }
    settled.current = true
    // No root, so no declaration to honour — and the values can never be read now. Clearing the
    // whole fragment is the one way to be sure a link's inputs do not linger on an error page.
    if (fragment.pairs.size) { clearFragment('all') }
  }, [fragment])

  const value = useMemo<PageRoot>(() => ({ endpoint, failed, fragment, resolved }), [endpoint, failed, fragment, resolved])
  return <PageRootContext.Provider value={value}>{children}</PageRootContext.Provider>
}
