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
 *
 * AND A REFUSAL SAYS WHERE IT COULD HAVE GONE. "page-x cannot hold a cards" is true and still
 * leaves the next attempt a guess; on a page with four containers the guess is usually wrong, and a
 * second wrong guess is how a turn is spent. So a refusal carries the containers that WOULD have
 * accepted it — computed by `legalTargets`, the same kernel the canvas highlights drop zones with
 * and the one `planMove` consults to refuse in the first place. It was already working the set out
 * and throwing it away.
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
  /**
   * On a refusal: the containers that WOULD have accepted this, by name. Empty when nothing would,
   * and when the request was too malformed to ask the question ("which container accepts a widget
   * the draft does not carry?" has no answer).
   *
   * A refusal that only says no leaves the next proposal a guess, and a second wrong guess is how a
   * turn is spent. The set is not re-derived here: `legalTargets` is the kernel the canvas
   * highlights drop zones with and the one `planMove` already consults to refuse — this stops
   * discarding what it worked out.
   */
  where?: string[]
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
  /**
   * CREATE a widget of any kind inside `target` — the agent's equivalent of a palette drop.
   *
   * Its absence is why an agent asked for "a table of pods" could only reach for `addExisting` and
   * place something that already existed, or something that did not. A person can create any of the
   * forty-four kinds; until this op the agent could create five layout containers and nothing else,
   * so every request for a real widget had to be answered with the wrong verb.
   *
   * `widgetData` is the CRD's own shape, exactly as `CreateWidgetModal` collects it.
   */
  | { op: 'addWidget'; kind: string; name: string; widgetData?: Record<string, unknown>; target: string; at?: number }
  /**
   * Point a widget at its data — the agent's equivalent of the Data modal.
   *
   * Creating a Table is half an answer; a Table with no `apiRef` renders an empty frame. `action`
   * authors a new RESTAction, `actionRef` names one that already exists, and the two templates fill
   * the widget from its result. All three parts are optional so an agent can bind data to a widget
   * it did not create, or re-point one it did.
   */
  | {
    op: 'bindData'
    widget: string
    action?: { name: string; steps: { name: string; path: string; verb?: string; dependsOn?: string }[]; filter: string }
    actionRef?: { name: string; namespace?: string }
    dataTemplate?: { forPath: string; expression: string }[]
    refsTemplate?: { iterator: string; template: { resource?: string; name?: string } }[]
  }

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
 * THE REFUSAL THE MODEL ACTUALLY HEARS.
 *
 * A chip is not a channel to the agent. The turn transmits `{context, contextId, sessionId, text}`
 * and nothing else — `message.actions` is local UI state that never leaves the browser — so every
 * refusal above reaches the PERSON and stops there. The model saw its own directive, then a fresh
 * user message, and no sign that anything had gone wrong; on the next turn it could only infer a
 * failure from a draft that had not changed.
 *
 * That is the whole reason a verbal-reflection loop had nothing to work with, and it is not fixed
 * by making the refusal better worded. It is fixed by putting it where the model reads.
 *
 * `previewProblems` already solved exactly this for rejected previews: the verdicts are held here,
 * the context collector surfaces them on the envelope, and the model corrects itself without the
 * user relaying anything. This is that mechanism for compose, deliberately the same shape.
 *
 * WHEN IT CLEARS. On any APPLIED compose: the draft has moved, so a refusal computed against the
 * old one may no longer be true, and a stale "you cannot put a card in page-x" is worse than
 * silence. Not on delivery — an unfixed problem should keep riding, which is what makes it a
 * standing correction rather than a notification.
 */
export interface ComposeRefusalNote {
  /** The proposal that was refused, restated so the model can tell WHICH one this is about. */
  tried: string
  reason: string
  /** Containers that would have accepted it — the corrected proposal, ready to re-issue. */
  where?: string[]
}

/** Enough to describe a turn that went wrong several times; capped so a loop cannot fill the
 *  envelope with its own history. Oldest drop out first. */
const MAX_REFUSALS = 5

let composeRefusals: ComposeRefusalNote[] = []

/** A one-line restatement of the op, so a note says what it is about without the model re-reading
 *  its own directive. */
const describeOp = (op: ComposeOp): string => {
  if (op.op === 'move') {
    return `move ${op.widget} into ${op.target}`
  }
  if (op.op === 'addContainer') {
    return `add a ${op.layout} inside ${op.target}`
  }
  if (op.op === 'addWidget') {
    return `create a ${op.kind} named ${op.name} inside ${op.target}`
  }
  if (op.op === 'bindData') {
    // Says WHICH data, because "bind data to X" read identically whether the agent pointed the
    // widget at a new RESTAction, an existing one, or neither — and those fail differently.
    let source = 'no action'
    if (op.action) {
      source = `a new ${op.action.name}`
    } else if (op.actionRef) {
      source = op.actionRef.name
    }
    return `bind ${op.widget} to ${source}`
  }
  return `place ${op.name} inside ${op.target}`
}

export const recordComposeOutcome = (op: ComposeOp, result: ComposeResult): void => {
  if (result.applied) {
    // The draft moved. Every held refusal was computed against the draft as it was.
    composeRefusals = []
    return
  }
  const note: ComposeRefusalNote = {
    reason: result.reason ?? 'the composer did not apply it',
    tried: describeOp(op),
    ...(result.where?.length ? { where: result.where } : {}),
  }
  // A repeat replaces its predecessor rather than stacking: the same proposal refused twice is one
  // standing problem, and listing it twice would read as two.
  composeRefusals = [...composeRefusals.filter((held) => held.tried !== note.tried), note].slice(-MAX_REFUSALS)
}

/**
 * A chart verb's outcome, on the same channel: a chip never leaves the browser, so this is the only
 * way the model learns its chartPut / chartDelete / chartLink was refused. `reason` null = it wrote,
 * and the chart moved, so every held refusal is dropped exactly as an applied compose drops them.
 */
export const recordChartOutcome = (tried: string, reason: string | null): void => {
  if (reason === null) {
    composeRefusals = []
    return
  }
  composeRefusals = [...composeRefusals.filter((held) => held.tried !== tried), { reason, tried }].slice(-MAX_REFUSALS)
}

/** The standing compose refusals, for the context collector. Null when there are none. */
export const getComposeRefusals = (): ComposeRefusalNote[] | null =>
  (composeRefusals.length ? composeRefusals : null)

/** Drop everything held — a new draft is not answerable for the last one's refusals. */
export const clearComposeRefusals = (): void => {
  composeRefusals = []
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
    const timedOut: ComposeResult = { applied: false, id, paths: [], reason: 'no page composer is open to apply this' }
    recordComposeOutcome(request, timedOut)
    resolve(timedOut)
  }, timeoutMs)
  sub.stop = onComposeResult((result) => {
    // Not our answer: another composer, or a reply to a request that has already timed out.
    if (result.id !== id) {
      return
    }
    clearTimeout(timer)
    sub.stop?.()
    // Every outcome is recorded HERE, the single point every answer passes through, rather than at
    // the three bridge call sites — a fourth call site would otherwise be silent by omission.
    recordComposeOutcome(request, result)
    resolve(result)
  })
  emitComposeRequest({ ...request, id })
})
