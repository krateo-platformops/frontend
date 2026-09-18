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
 */
export const AUTOPILOT_COMPOSE_REQUEST_EVENT = 'autopilotComposeRequest'

export type ComposeRequest =
  /** Move an existing node in the draft into `target`, optionally at an index. */
  | { op: 'move'; widget: string; target: string; at?: number }
  /** Place an existing cluster widget into `target`. */
  | { op: 'addExisting'; name: string; resource: string; target: string; at?: number }
  /** Create a layout container inside `target`. */
  | { op: 'addContainer'; layout: string; target: string; at?: number }

export const emitComposeRequest = (detail: ComposeRequest): void => {
  window.dispatchEvent(new CustomEvent<ComposeRequest>(AUTOPILOT_COMPOSE_REQUEST_EVENT, { detail }))
}

export const onComposeRequest = (handler: (detail: ComposeRequest) => void): (() => void) => {
  const listener = (event: Event) => {
    const { detail } = event as CustomEvent<ComposeRequest>
    handler(detail)
  }
  window.addEventListener(AUTOPILOT_COMPOSE_REQUEST_EVENT, listener)
  return () => window.removeEventListener(AUTOPILOT_COMPOSE_REQUEST_EVENT, listener)
}
