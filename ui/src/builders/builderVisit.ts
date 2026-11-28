/**
 * Whether this document has been on a builder's page: said by the shell, which has the router, and heard
 * by what runs without one (the Agentiko provider). It only ever becomes true.
 */
let visited = false
const listeners = new Set<() => void>()

export const noteBuilderVisit = (): void => {
  if (visited) { return }
  visited = true
  listeners.forEach((listener) => { listener() })
}

export const hasVisitedBuilder = (): boolean => visited

export const subscribeBuilderVisit = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test-only: a fresh document. */
export const resetBuilderVisit = (): void => { visited = false }
