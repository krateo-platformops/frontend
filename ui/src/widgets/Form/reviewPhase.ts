import { useSyncExternalStore } from 'react'

/**
 * Is a Form on this page showing its Review step?
 *
 * The review is the Form's own in-place state, and the wizard header that numbers it ("Step 3 ·
 * Review") is a separate Steps widget with a static `current`. Nothing joined them, so the header
 * still read "Step 2 · Configure" while the page showed the review. A page-level signal is the
 * smallest join: the Form says when it is reviewing, a Steps that opts in (`reviewCurrent`) reads
 * it. Keyed by form id, so a Form unmounting mid-review (navigation after a create) clears its own
 * entry and nobody else's.
 */
const reviewing = new Set<string>()
const listeners = new Set<() => void>()

const notify = () => { listeners.forEach((listener) => listener()) }

export const setFormReviewing = (formId: string, isReviewing: boolean) => {
  const had = reviewing.has(formId)
  if (isReviewing === had) { return }
  if (isReviewing) {
    reviewing.add(formId)
  } else {
    reviewing.delete(formId)
  }
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const snapshot = () => reviewing.size > 0

/** True while any Form on the page shows its Review step. */
export const useAnyFormReviewing = (): boolean => useSyncExternalStore(subscribe, snapshot, () => false)
