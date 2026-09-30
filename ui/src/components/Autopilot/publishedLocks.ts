/**
 * What the held draft may no longer change because it was PUBLISHED (T8, frontend#412 review item 6).
 *
 * A draft-kind plugin that has CEL-immutable fields (the controller's RestDefinitions: kind, group,
 * identifiers, configurationFields, status fields) takes a snapshot of them when a publish lands
 * (`DraftKindPlugin.lockedSnapshot`). The autosave keeps it on the draft record (`publish.locked`),
 * and restores it on Resume; this store is where the composer and the lint read it.
 *
 * WHY MODULE STATE — the same reason as draftSaveStatus: the autosave lives in the provider, the
 * composer is a route outside its context, and the lint runs inside the provider's store listener.
 *
 * It names the draft it is about (kind and display name), so a lock never leaks onto another draft:
 * `lockedFor` answers only for the draft with that kind and name.
 */
import { useSyncExternalStore } from 'react'

export interface PublishedLocks {
  kind: string
  /** The draft's display name (its Chart.yaml name) when it was published. */
  name: string
  locked: Record<string, Record<string, unknown>>
}

let current: PublishedLocks | null = null
const listeners = new Set<() => void>()

export const publishedLocks = {
  get: (): PublishedLocks | null => current,
  set: (next: PublishedLocks | null): void => {
    current = next
    listeners.forEach((listener) => listener())
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

/** The snapshot for the draft of this kind and name, or null when it was not published (or is another draft). */
export const lockedFor = (locks: PublishedLocks | null, kind: string | null | undefined, name: string | null | undefined): PublishedLocks['locked'] | null =>
  (locks && locks.kind === kind && locks.name === name ? locks.locked : null)

export const usePublishedLocks = (): PublishedLocks | null =>
  useSyncExternalStore(publishedLocks.subscribe, publishedLocks.get)
