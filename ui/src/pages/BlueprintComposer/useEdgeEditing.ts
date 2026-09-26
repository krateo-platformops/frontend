/**
 * Edges, as the composer edits them — screens 6 and 7, and the inspector's Depends-on rows.
 *
 * TWO WAYS TO START ONE, ONE PENDING EDGE. A drag from a card onto another (DependencyGraph's
 * `edgeDraw`), or — the guaranteed route, for a keyboard and a touch screen — the node inspector's
 * "Add dependency" Select. Both end in the same PENDING edge, which the edge inspector asks about:
 * wait for readiness or not, and what "ready" means. Nothing is written until Accept; Cancel, or Esc
 * from anywhere in the composer, lets it go.
 *
 * A DROP WHERE THE EDGE MAY NOT GO is refused on the spot, in the kernel's words ("Refused a moment
 * ago"): the cards that would close a loop never lit, and the refusal names where it could go.
 *
 * EVERY WRITE IS ONE BATCH (previewFilesBatch): the descriptor and every template it re-gates,
 * together or not at all, one Undo step — and, like every write to a chart, Publish off until Preview
 * renders it again. The plan is the kernel's (planEdge); a batch the provider refuses is said where
 * the gesture was made, and nothing is written.
 *
 * AFTER AN ACCEPT the composer says what happened (screen 7): the dependent's descriptor entry, a
 * sentence per rewritten template, and the dependent's template opened with its gate lit. That account
 * belongs to the bytes it describes — an Undo, or any other write to those templates, retires it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { emitFilesBatch, type FilesBatchDetail } from '../../components/Autopilot/previewFilesBatch'
import type { EdgeDraw } from '../../components/DependencyGraph'

import { ARCHITECTURE_TEMPLATE_PATH, parseArchitecture, serializeResource, unwrapFromConfigMapTemplate, type ChartArchitecture, type ResourceNode } from './architecture'
import type { DrawingStates } from './architectureView'
import { legalEdgeTargets, planEdge, planReadyWhen, planRemoveNode, type EdgeOp, type EdgePlan } from './planEdge'
import { defaultReadiness, readyWhenLabel } from './readyWhen'

export interface PendingEdge { from: string; to: string }

export interface AcceptedEdge {
  from: string
  to: string
  /** The dependent's entry in the descriptor, as it is now serialised. */
  entry: string
  /** One sentence per rewritten template. */
  lines: { path: string; text: string }[]
  /** How many files the batch rewrote — the neutral pill (D7). */
  rewritten: number
  /** The template bytes the batch wrote: when any of them changes, this account is retired. */
  wrote: Record<string, string>
}

type Files = Readonly<Record<string, string>>

/** What the dependent's gate waits for, in words (07:115). */
const guardWords = (target: ResourceNode | undefined, ready: boolean): string => {
  if (!ready || !target) { return 'its existence' }
  if (target.readyWhen) { return readyWhenLabel(target.readyWhen).replace(/^\./, '').replace(/ is set$/, '') }
  return defaultReadiness(target) ?? 'its readiness'
}

const archOf = (template: string | undefined): ChartArchitecture | null => {
  const descriptor = template === undefined ? null : unwrapFromConfigMapTemplate(template)
  const parsed = descriptor === null ? null : parseArchitecture(descriptor)
  return parsed?.ok ? parsed.architecture : null
}

const nothingWritten = (outcome: ReturnType<typeof emitFilesBatch>): string | null => {
  if (outcome?.ok) { return null }
  return `Nothing was written — ${outcome ? outcome.error : 'no provider answered, so the draft did not change'}`
}

/** The account of an accepted edge (screen 7), from the plan and the descriptor it wrote. */
const acceptedOf = (plan: Extract<EdgePlan, { ok: true }>, op: EdgeOp): AcceptedEdge => {
  const after = archOf(plan.edit[ARCHITECTURE_TEMPLATE_PATH])
  const from = after?.resources.find((node) => node.id === op.from)
  const to = after?.resources.find((node) => node.id === op.to)
  const ready = from?.dependsOn?.find((dep) => dep.ref === op.to)?.ready === true
  const templates = Object.keys(plan.edit).filter((path) => path !== ARCHITECTURE_TEMPLATE_PATH)
  const lines = templates.map((path) => {
    if (path === from?.template) {
      return { path, text: `Wrapped in a krateo:gate block: a lookup on the ${to?.kind ?? op.to}, guarded on ${guardWords(to, ready)}. Regenerated whenever the edge changes; deleted when the edge is.` }
    }
    const who = after?.resources.find((node) => node.template === path)?.id ?? path
    return { path, text: `Its gate regenerated: ${who} now waits for ${op.to} by ${guardWords(to, true)} — readyWhen belongs to ${op.to}, not to one edge.` }
  })
  const wrote = Object.fromEntries(templates.map((path) => [path, plan.edit[path]]))
  return { entry: from ? serializeResource(from) : '', from: op.from, lines, rewritten: Object.keys(plan.edit).length, to: op.to, wrote }
}

export interface EdgeEditingInput {
  /** The held files as the last broadcast carried them — what every plan is made from. */
  filesRef: React.MutableRefObject<Files>
  /** The held files now, for noticing an accepted edge's bytes change. */
  files: Files
  /** The descriptor as drawn (null when there is none to draw). */
  architecture: ChartArchitecture | null
  /** An accepted edge opens the dependent's template, its gate lit. */
  onAccepted: (edge: AcceptedEdge, template: string) => void
}

export const useEdgeEditing = ({ architecture, files, filesRef, onAccepted }: EdgeEditingInput) => {
  const [drawing, setDrawing] = useState<{ source: string; legal: string[] } | null>(null)
  const [pending, setPending] = useState<PendingEdge | null>(null)
  const [refusedMoment, setRefusedMoment] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<AcceptedEdge | null>(null)
  const archRef = useRef(architecture)
  archRef.current = architecture
  const acceptedRef = useRef(onAccepted)
  acceptedRef.current = onAccepted

  const cancel = useCallback(() => {
    setDrawing(null)
    setPending(null)
  }, [])

  /** The pending edge from `from` to `to` — or, when it may not be drawn, the kernel's refusal. */
  const choose = useCallback((from: string, to: string) => {
    setDrawing(null)
    setAccepted(null)
    const arch = archRef.current
    if (arch && legalEdgeTargets(arch, from).legal.includes(to)) {
      setRefusedMoment(null)
      setPending({ from, to })
      return
    }
    const plan = planEdge(filesRef.current, { from, op: 'add', to })
    setPending(null)
    setRefusedMoment(plan.ok ? null : plan.reason)
  }, [filesRef])

  // The drag: stable for the life of the page (DependencyGraph builds its options once from it).
  const edgeDraw = useMemo((): EdgeDraw => ({
    canStart: (id) => !!archRef.current?.resources.some((node) => node.id === id && !node.lifecycle),
    onCancel: () => setDrawing(null),
    onDrop: (source, target) => choose(source, target),
    onStart: (id) => {
      const arch = archRef.current
      setRefusedMoment(null)
      setPending(null)
      setDrawing({ legal: arch ? legalEdgeTargets(arch, id).legal : [], source: id })
    },
  }), [choose])

  // A pending edge (or a drag) whose endpoint the held chart no longer has — an Undo, a Chart files
  // edit of the descriptor, the agent's write — is let go. Kept, it left the side column with
  // neither inspector (so no Cancel), the palette disabled, and "Drawing: a → b" for a node gone.
  useEffect(() => {
    const has = (id: string): boolean => !!architecture?.resources.some((node) => node.id === id)
    if (pending && !(has(pending.from) && has(pending.to))) { setPending(null) }
    if (drawing && !has(drawing.source)) { setDrawing(null) }
  }, [architecture, drawing, pending])

  // Esc lets a pending edge (or a drag) go, from anywhere in the composer.
  const active = !!pending || !!drawing
  useEffect(() => {
    if (!active) { return undefined }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { cancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, cancel])

  // An accepted edge's account is retired once the bytes it describes are not the ones held.
  useEffect(() => {
    if (accepted && Object.entries(accepted.wrote).some(([path, text]) => files[path] !== text)) {
      setAccepted(null)
    }
  }, [accepted, files])

  const drawingStates = useMemo((): DrawingStates => ({
    legal: drawing?.legal,
    pendingFrom: pending?.from ?? null,
    pendingTo: pending?.to ?? null,
    source: drawing?.source ?? null,
  }), [drawing, pending])

  /** The pending edge as the kernel sees it with these answers — live, for the inspector's red box. */
  const planPending = useCallback((op: EdgeOp): EdgePlan => planEdge(filesRef.current, op), [filesRef])

  /** Accept: one batch, then the account. The error in words when nothing was written. */
  const accept = useCallback((op: EdgeOp): string | null => {
    const plan = planEdge(filesRef.current, op)
    if (!plan.ok) { return plan.reason }
    const detail: FilesBatchDetail = { edit: plan.edit, expect: plan.expect, kind: 'blueprint' }
    const refused = nothingWritten(emitFilesBatch(detail))
    if (refused) { return refused }
    const edge = acceptedOf(plan, op)
    const template = archRef.current?.resources.find((node) => node.id === op.from)?.template
    setPending(null)
    setAccepted(edge)
    if (template) { acceptedRef.current(edge, template) }
    return null
  }, [filesRef])

  /** One of the inspector's writes: the kernel's plan in one batch — or why not. */
  const write = useCallback((plan: EdgePlan | ReturnType<typeof planRemoveNode>): string | null => {
    if (!plan.ok) { return plan.reason }
    const detail: FilesBatchDetail = { edit: plan.edit, expect: plan.expect, kind: 'blueprint', ...('remove' in plan && plan.remove.length ? { remove: plan.remove } : {}) }
    const refused = nothingWritten(emitFilesBatch(detail))
    if (!refused) { setAccepted(null) }
    return refused
  }, [])

  const setEdgeReady = useCallback((from: string, to: string, ready: boolean) => write(planEdge(filesRef.current, { from, op: 'set', ready, to })), [filesRef, write])
  const removeEdge = useCallback((from: string, to: string) => write(planEdge(filesRef.current, { from, op: 'remove', to })), [filesRef, write])
  const setReadyWhen = useCallback((id: string, readyWhen: string | null) => write(planReadyWhen(filesRef.current, id, readyWhen)), [filesRef, write])
  const removeNode = useCallback((id: string) => write(planRemoveNode(filesRef.current, id)), [filesRef, write])

  const dismissAccepted = useCallback(() => setAccepted(null), [])
  const dismissRefusal = useCallback(() => setRefusedMoment(null), [])

  /** A discard, or the person moving on: nothing about an edge is left standing. */
  const reset = useCallback(() => {
    setDrawing(null)
    setPending(null)
    setRefusedMoment(null)
    setAccepted(null)
  }, [])

  return {
    accept,
    accepted,
    cancel,
    choose,
    dismissAccepted,
    dismissRefusal,
    drawing,
    drawingStates,
    edgeDraw,
    pending,
    planPending,
    refusedMoment,
    removeEdge,
    removeNode,
    reset,
    setEdgeReady,
    setReadyWhen,
  }
}
