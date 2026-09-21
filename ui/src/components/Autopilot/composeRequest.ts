/**
 * The agent asking the composer to restructure the held draft.
 *
 * WHY A BUS AND NOT A DIRECT CALL. The action bridge knows the proposal; only the composer knows
 * the draft. Handing the bridge the files would give two owners to one mutable thing, which is the
 * shape that produced the stale-payload bug the draft buses already exist to prevent. This mirrors
 * `previewFileEdit` exactly: a window CustomEvent, no React, no module state.
 *
 * WHY THE AGENT DOES NOT COMPUTE THE EDIT ITSELF. It could propose the resulting YAML — it already
 * can, via previewPage's rawTemplates. It must not for structural edits, because then the agent and
 * the canvas would each decide what a container may hold, and the two would drift. The agent names
 * the INTENT ("put this widget in that container"); `planMove`/`planAdd` decide whether it is legal
 * and what bytes result. One kernel, whoever asks.
 *
 * WHAT THIS IS NOT. It does not publish, submit, or touch the apiserver. It rewrites bytes the
 * person already holds in a draft they are looking at, and every existing gate stays where it was:
 * the preview gate still arms per identity, and the change request is still raised by a human.
 *
 * AND IT ANSWERS. This was fire-and-forget: the bridge emitted a request and returned
 * "Added a Card inside page-x" without ever learning whether the composer accepted it. Observed on
 * krateo-057 — the rail reported that exact success, READ-ONLY and with no error, while the canvas
 * had no card and the composer had raised no alert. The agent could not tell, the chip could not
 * tell, and neither could the person reading it.
 *
 * The refusal was not missing, it was DISCARDED: `planAdd`/`planMove` already compute a precise
 * reason ("a Row may not hold a Card", "\"x\" is not in this draft") and it died at this boundary.
 *
 * So a request now carries an `id` and the composer answers on a result channel — the same shape
 * `previewPublishRequest` has used all along, for the same reason. Two consequences, in order of
 * importance: the chip stops asserting an outcome it does not know, and the agent gets an
 * environment signal it can act on. The second is the precondition for any self-correction at all;
 * a verbal-reflection loop over an unconditional "success" has nothing to reflect on.
 */
export const AUTOPILOT_COMPOSE_REQUEST_EVENT = 'autopilotComposeRequest'
export const AUTOPILOT_COMPOSE_RESULT_EVENT = 'autopilotComposeResult'

/** Correlates a request with its answer. The caller generates it and ignores answers that are not
 *  its own — a second composer surface (or a stale listener) must never resolve someone else's. */
export interface ComposeResult {
  id: string
  /** True when the draft actually changed. */
  applied: boolean
  /** Why it was refused, in the kernel's own words. Null when applied. */
  reason: string | null
  /** The draft paths the edit rewrote or created — what changed, not just that something did. */
  paths: string[]
}

/** The restructure itself, without correlation — `Omit` does not distribute over a union, so the
 *  op and its id are named separately rather than subtracted. */
export type ComposeOp =
  /** Move an existing node in the draft into `target`, optionally at an index. */
  | { op: 'move'; widget: string; target: string; at?: number }
  /** Place an existing cluster widget into `target`. */
  | { op: 'addExisting'; name: string; resource: string; target: string; at?: number }
  /** Create a layout container inside `target`. */
  | { op: 'addContainer'; layout: string; target: string; at?: number }

/** An op plus the id its answer will carry. */
export type ComposeRequest = ComposeOp & { id: string }

export const emitComposeRequest = (detail: ComposeRequest): void => {
  window.dispatchEvent(new CustomEvent<ComposeRequest>(AUTOPILOT_COMPOSE_REQUEST_EVENT, { detail }))
}

export const onComposeRequest = (handler: (detail: ComposeRequest) => void): (() => void) => {
  const listener = (event: Event) => {
    const { detail } = event as CustomEvent<ComposeRequest>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_COMPOSE_REQUEST_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_COMPOSE_REQUEST_EVENT, listener)
}

export const emitComposeResult = (detail: ComposeResult): void => {
  window.dispatchEvent(new CustomEvent<ComposeResult>(AUTOPILOT_COMPOSE_RESULT_EVENT, { detail }))
}

export const onComposeResult = (handler: (detail: ComposeResult) => void): (() => void) => {
  const listener = (event: Event) => {
    const { detail } = event as CustomEvent<ComposeResult>
    if (detail && typeof detail.id === 'string') {
      handler(detail)
    }
  }
  window.addEventListener(AUTOPILOT_COMPOSE_RESULT_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_COMPOSE_RESULT_EVENT, listener)
}

/**
 * Ask the composer to restructure, and WAIT for its answer.
 *
 * Bounded: with no composer mounted nothing ever answers, and an action that hangs forever is worse
 * than one that reports honestly that it could not be delivered. The timeout is the "no surface"
 * case, not a slow one — the composer answers synchronously within its own handler.
 */
export const requestCompose = (
  request: ComposeOp,
  timeoutMs = 4000,
): Promise<ComposeResult> => new Promise((resolve) => {
  const id = `compose-${Date.now()}-${Math.random().toString(36).slice(2)}`
  // The timer and the listener each have to be able to cancel the other, so one of the two is
  // referenced before it exists; the holder is what lets the reference be a const.
  const sub: { stop?: () => void } = {}
  const timer = setTimeout(() => {
    sub.stop?.()
    resolve({ applied: false, id, paths: [], reason: 'no page composer is open to apply this' })
  }, timeoutMs)
  sub.stop = onComposeResult((result) => {
    // Not our answer: another composer, or a reply to a request that has already timed out.
    if (result.id !== id) {
      return
    }
    clearTimeout(timer)
    sub.stop?.()
    resolve(result)
  })
  emitComposeRequest({ ...request, id })
})
