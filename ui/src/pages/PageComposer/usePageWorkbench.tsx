/**
 * The Portal Builder's WORKBENCH — the editor state its palette (`widgets`), canvas (`page-grid`) and
 * inspector (`object-tree`) share about a held page, for ComposerHost to mount (T4, frontend#410).
 * The host owns the page, its header, the split and the files pane; this owns the page draft.
 *
 * WHAT A PAGE IS HERE. The same surface Autopilot opens when it previews a draft — the live render,
 * the Files tab with its per-file editor, the RestDefinition editor, the validation verdicts — with a
 * palette, a canvas and the object tree above it. A Form cannot express a tree, and `SchemaFields` has
 * no repeatable-row control, so the Form widgets this replaced could only emit a FLAT page of widgets
 * with STATIC widgetData — no Rows, Cols, Tabs, no `apiRef`, no `widgetDataTemplate`: locked out of
 * the half of the corpus that computes its data server-side (212 of 425 shipped widget templates).
 *
 * WHAT IT DOES NOT CHANGE. Autopilot still proposes drafts onto the same CustomEvent bus, and its
 * drawer still opens. Publishing still ends at a form a person submits — the agent's never-submit
 * guarantee is not weakened by any of this.
 */
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { Alert } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { HostDraft, Workbench } from '../../builders/host/hostTypes'
import { emitComposeResult, onComposeRequest } from '../../components/Autopilot/composeRequest'
import { AUTOPILOT_PREVIEW_EVENT, isBuilderPayload } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { emitDraftStart } from '../../components/Autopilot/previewDraftStart'
import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { LIVE_PREVIEW_CAPTION_INLINE } from '../../components/Autopilot/previewPageV2'

import { authorWidget, bindData } from './composeAuthoring'
import { announce, onAnnounce } from './composerAnnounce'
import { ComposerEmptyState } from './ComposerEmptyState'
import CreateWidgetModal from './CreateWidgetModal'
import { resolveDrop } from './dndIds'
import type { DragPayload, DropPayload } from './dndIds'
import { legalTargets } from './dropTargets'
import { heldPagePayload } from './heldPagePayload'
import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import styles from './PageComposer.module.css'
import type { PalettePick } from './PalettePanel'
import { widgetExists } from './placeableWidgets'
import { planAdd } from './planAdd'
import { planMove } from './planMove'
import StartDraftModal from './StartDraftModal'
import { LAYOUT_KINDS } from './structureEdit'
import { WIDGET_KINDS } from './widgetKinds.generated'

/**
 * Where a newly started page is created.
 *
 * The portal's own release namespace is the honest answer and the frontend does not know it, so
 * this matches `PORTAL_CHART_REPO_DEFAULTS` — the same default every other builder path assumes.
 * It is visible and editable in the Files tab before anything is published, which is the backstop.
 */
const NEW_DRAFT_NAMESPACE = 'krateo-system'

/**
 * POINTER FIRST, RECTANGLES WHEN THERE IS NO POINTER.
 *
 * `pointerWithin` is the right strategy for this canvas and the wrong one on its own. The canvas is
 * nested containers — wells inside wells — and rectangle overlap resolves an inner well and all of
 * its ancestors as equally good candidates, so asking which droppable the POINTER is inside is what
 * makes exactly one thing light up.
 *
 * But it answers by pointer position, and A KEYBOARD DRAG HAS NO POINTER. With `pointerWithin`
 * alone, every keyboard drag lifted correctly, announced correctly, moved correctly — and could
 * never resolve a target, so `over` was always null and the drop silently did nothing. The whole
 * keyboard path was impossible, in the change that was bought to provide it, and both the sensor
 * and the ARIA attributes were present and correct the entire time. A test that drives the sensor
 * is the only thing that finds this; a test that asserts the handle has a role does not.
 *
 * So: pointer when there is one, rectangle intersection when there is not.
 */
const composerCollisions: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args)
  return byPointer.length ? byPointer : rectIntersection(args)
}

/** What the drag chip says: the kind being created, or the name of the thing being placed. */
const airborneLabel = (payload: DragPayload): string => {
  if (payload.from === 'canvas') { return payload.node.name }
  if (payload.pick.kind === 'container') { return payload.pick.layout }
  if (payload.pick.kind === 'new') { return payload.pick.widgetKind }
  return payload.pick.name
}

/** The human name of whatever a drag id refers to — `over` is a droppable, `active` a draggable. */
const nameOfDrag = (payload: unknown): string => {
  const drag = payload as DragPayload | undefined
  if (drag?.from === 'canvas') { return drag.node.name }
  if (drag?.from === 'palette') { return airborneLabel(drag) }
  const drop = payload as DropPayload | undefined
  if (drop?.at === 'gap') { return `position ${drop.index + 1} in ${drop.node.name}` }
  if (drop?.at === 'well') { return drop.node.name }
  return 'the page'
}

/**
 * WHAT A KEYBOARD DRAG SAYS. Every string here replaces one that read an internal id aloud.
 *
 * `onDragEnd` deliberately does not claim the move succeeded: the KERNEL decides, and it may refuse
 * for a reason this callback cannot see. The composer's own live region announces the outcome a
 * moment later, so saying "moved" here would be the drag asserting something the draft may not
 * have done — the same defect the compose chip had.
 */
const dragAnnouncements = {
  onDragCancel: ({ active }: { active: { data: { current?: unknown } } }) =>
    `Cancelled. ${nameOfDrag(active.data.current)} was not moved.`,
  onDragEnd: ({ active, over }: { active: { data: { current?: unknown } }; over?: { data: { current?: unknown } } | null }) =>
    (over
      ? `Dropped ${nameOfDrag(active.data.current)} on ${nameOfDrag(over.data.current)}.`
      : `${nameOfDrag(active.data.current)} was dropped outside every container.`),
  onDragMove: ({ over }: { over?: { data: { current?: unknown } } | null }) =>
    (over ? `Over ${nameOfDrag(over.data.current)}.` : 'Over nothing droppable.'),
  onDragOver: ({ over }: { over?: { data: { current?: unknown } } | null }) =>
    (over ? `Over ${nameOfDrag(over.data.current)}.` : 'Over nothing droppable.'),
  onDragStart: ({ active }: { active: { data: { current?: unknown } } }) =>
    `Picked up ${nameOfDrag(active.data.current)}. Use the arrow keys to move it, space to drop, escape to cancel.`,
}

/**
 * What a structural edit did — the composer's answer to whoever asked.
 *
 * The kernel already decides and already says why when it refuses; this is only what carries that
 * decision back out. A drag ignores it (the canvas re-renders and the person sees the result); an
 * agent needs it, because nothing else tells it whether its proposal landed.
 */
type Outcome =
  | { ok: true; paths: string[] }
  | { ok: false; paths: string[]; reason: string; where?: string[] }

/**
 * How many alternative containers a refusal names.
 *
 * Enough to be an answer on any real page, capped so a pathological draft cannot turn one refusal
 * into an inventory. Ordered as the tree reads, so the first name is the outermost container that
 * would take it rather than an arbitrary one.
 */
const MAX_ALTERNATIVES = 12

/** The containers that would accept `plural`, by name — `legalTargets`, never a second opinion. */
const acceptedBy = (
  roots: readonly TreeNode[],
  plural: string | null | undefined,
  moving?: TreeNode,
): string[] => (plural
  ? legalTargets(roots, { node: moving, plural }).map((node) => node.name).slice(0, MAX_ALTERNATIVES)
  : [])

export const usePageWorkbench = (host: HostDraft) => {
  const { api, builder, files, kind, mode, openFile, resetVerdicts } = host
  // The page only DEGRADES without config — the widget picker reports that it cannot reach the list.
  const snowplowBaseUrl = api?.SNOWPLOW_API_BASE_URL ?? ''
  /** Where drafts — and anything an agent authors for one — are actually applied. */
  const previewSandboxNamespace = api?.PREVIEW_SANDBOX_NAMESPACE ?? ''
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  // The payload as ADOPTED, not as rendered — see the discard listener.
  const adopted = useRef<AutopilotPreviewPayload | null>(null)
  // Why a move can be refused, shown where the other outcomes are shown. Not antd `message`: the
  // composer already reports through Alerts, and a toast that vanishes is the wrong surface for
  // "this drop was rejected and here is why".
  const [moveError, setMoveError] = useState<string | null>(null)

  /**
   * A drop that cannot be applied yet, because the kind has required fields nobody has supplied.
   *
   * Held rather than applied: `planAdd` refuses a `new` pick with no authored widgetData, and it is
   * right to — a widget missing a required field is rejected at apply, which surfaces at publish.
   * So the gesture pauses here, the modal asks, and the SAME target and index are used when it
   * answers. Recomputing the target from the tree afterwards would resolve a node that the answer
   * may have taken a while to arrive at.
   */
  const [pendingCreate, setPendingCreate] = useState<{ at?: number; target: TreeNode; widgetKind: string } | null>(null)
  /**
   * The live region's text. Held in state so a repeat of the same sentence still re-announces —
   * moving two widgets into the same container really does produce the same words twice, and a
   * reader that heard it once would otherwise believe the second gesture did nothing.
   */
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => onAnnounce((message) => {
    setAnnouncement('')
    // A frame apart, so assistive technology sees a CHANGE rather than an identical value.
    window.setTimeout(() => setAnnouncement(message), 0)
  }), [])
  const [airborne, setAirborne] = useState<DragPayload | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /**
   * Where a NEW object this page authors is created.
   *
   * The draft's own namespaces are Helm templates once serialized as a chart, so `draftNamespace`
   * legitimately finds none — and "none" must not mean "refuse to bind data". A page started here
   * was started in NEW_DRAFT_NAMESPACE; that is the honest fallback, and it is the same namespace
   * every other builder path assumes.
   */
  const authoringNamespace = draftNamespace(files) ?? NEW_DRAFT_NAMESPACE

  /**
   * ONE tree per render, shared by the canvas and by the drop handler.
   *
   * `legalTargets` compares nodes by REFERENCE, so a canvas that built its own tree and a handler
   * that built another would agree about the page and disagree about its nodes — the highlight
   * would light a node the drop then could not find.
   */
  const roots = useMemo(() => buildObjectTree(files), [files])

  /**
   * A palette drop: plan it, then persist through the same buses a hand edit uses.
   *
   * ORDER IS LOAD-BEARING when a container was created — the file must be ADDED before the parent
   * that references it, or the parent momentarily names a file the draft does not carry. planAdd
   * returns the created file separately so this cannot be got the wrong way round by accident.
   */
  const applyAdd = useCallback((target: TreeNode, at: number | undefined, picked: PalettePick): Outcome => {
    const plan = planAdd(files, target, picked, authoringNamespace, at)
    if (!plan.ok) {
      setMoveError(plan.reason)
      // A palette pick is under nothing, so nothing is excluded — every container that declares it
      // holds this plural is a real alternative. The tree is rebuilt from the same `files` the plan
      // just refused against, so the answer describes the draft the refusal was about.
      return { ok: false, paths: [], reason: plan.reason, where: acceptedBy(buildObjectTree(files), picked.resource) }
    }
    setMoveError(null)
    if (plan.created) {
      emitFileAdd(plan.created)
    }
    Object.entries(plan.files).forEach(([path, content]) => emitFileEdit({ content, path }))

    return { ok: true, paths: [...(plan.created ? [plan.created.path] : []), ...Object.keys(plan.files)] }
  }, [authoringNamespace, files])

  /**
   * A drop from the canvas: plan it, then persist through the SAME file-edit bus the Files tab uses
   * (emitFileEdit -> blueprintDraftStore -> broadcast -> the `files` this component holds). Nothing
   * is written directly, so a move goes through the draft's own byte cap and gate-rearming exactly
   * like a hand edit, and the canvas re-renders from the store rather than from local state.
   *
   * `roots` comes from the canvas rather than being rebuilt here — see CanvasPanel's onMove.
   */
  const applyMove = useCallback((moving: TreeNode, target: TreeNode, roots: readonly TreeNode[], at?: number): Outcome => {
    const plan = planMove(files, roots, moving, target, at)
    if (!plan.ok) {
      setMoveError(plan.reason)
      // `moving` is passed so its own subtree is excluded: offering a container as an alternative
      // destination for something it sits inside would be an answer that is refused in turn.
      return { ok: false, paths: [], reason: plan.reason, where: acceptedBy(roots, moving.resource, moving) }
    }
    setMoveError(null)
    // Only the files the transaction changed — usually the two parents, one for a same-parent move.
    Object.entries(plan.files).forEach(([path, content]) => emitFileEdit({ content, path }))

    return { ok: true, paths: Object.keys(plan.files) }
  }, [files])
  /**
   * dnd-kit sensors.
   *
   * PointerSensor covers mouse, trackpad AND touch — the canvas was completely inert on a coarse
   * pointer before, because native HTML5 drag does not fire there at all. The 6px activation
   * distance is what keeps a CLICK on the kind label (which selects the node) from being swallowed
   * as a micro-drag.
   *
   * KeyboardSensor is the one there was no substitute for: not one of 80 tab stops used to land in
   * the canvas or the palette, and the object tree — documented in this file as the keyboard route
   * — sent focus to BODY after every edit. Space lifts, arrows move, Space drops, Escape cancels.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    setAirborne(event.active.data.current as DragPayload)
    setDraggingId(String(event.active.id))
  }, [])

  /**
   * The end of a gesture, and the point of the whole migration.
   *
   * An ILLEGAL drop arrives here. Under native DnD it could not: `preventDefault` on `dragover` is
   * what makes an element a drop target, so declining to call it — correct, and what the old canvas
   * did — meant `drop` never fired and `planAdd`/`planMove`'s refusal text was unreachable from a
   * drag. Every container is a droppable now and the KERNEL decides, so a refused drop says why
   * through the same Alert a tree action uses.
   */
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const intent = resolveDrop(
      event.active.data.current as DragPayload | undefined,
      event.over?.data.current as DropPayload | undefined,
    )
    setAirborne(null)
    setDraggingId(null)
    if (intent.do === 'add') {
      if (intent.pick.kind === 'new' && !intent.pick.authored) {
        setPendingCreate({ at: intent.at, target: intent.target, widgetKind: intent.pick.widgetKind })
        return
      }
      const added = applyAdd(intent.target, intent.at, intent.pick)
      announce(added.ok
        ? `Added to ${intent.target.name}`
        : `Not added: ${added.reason}`)
    } else if (intent.do === 'move') {
      const moved = applyMove(intent.moving, intent.target, roots, intent.at)
      announce(moved.ok
        ? `Moved ${intent.moving.name} into ${intent.target.name}`
        : `Not moved: ${moved.reason}`)
    }
  }, [applyAdd, applyMove, roots])

  const onDragCancel = useCallback(() => {
    setAirborne(null)
    setDraggingId(null)
  }, [])
  const [starting, setStarting] = useState(false)

  // The SAME bus the drawer listens on. A preview proposed by Autopilot while this page is open
  // therefore lands here too — which is the point: one draft, two doors. Deliberately not a
  // separate channel; a second bus would be a second source of truth about what is being authored.
  // (The host claims the preview surface for this draft kind, so the drawer does not ALSO open.)
  const builderName = builder.metadata.name
  useEffect(() => {
    const onPreview = (event: CustomEvent<AutopilotPreviewPayload>) => {
      // Only a PAGE preview is ours. The drawer defers to this page for exactly those and opens for
      // everything else, so adopting a chart or an inspection here would take it from the one
      // surface that can show it — and hand this one a payload it would render under page rules.
      if (!isBuilderPayload(event.detail, builderName)) {
        return
      }
      adopted.current = event.detail
      setPayload(event.detail)
      resetVerdicts()
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
  }, [builderName, resetVerdicts])

  /**
   * THE AGENT RESTRUCTURING THE DRAFT — through the same kernel as a drag.
   *
   * The proposal names the intent ("put this widget in that container"); everything that decides
   * whether it is legal and what bytes result is `planMove`/`planAdd`, unchanged. So an agent
   * cannot place a child a person could not have dragged there, and a refusal reads the same way
   * for both — including in the same Alert.
   *
   * Nodes are resolved from ONE tree so the identities `legalTargets` compares by reference all
   * come from the same build; rebuilding per lookup would make every proposal illegal for a reason
   * no message could explain (the trap #304 documents).
   */
  useEffect(() => onComposeRequest((request) => {
    // `void` the promise rather than handing an async function to a void-returning callback: the
    // asker is answered through `reply`, never through a return value, so nothing is dropped by
    // not awaiting here — and the emitter keeps its synchronous contract.
    void (async () => {
    // EVERY PATH ANSWERS. The handler used to `return` on each refusal, setting a local Alert and
    // telling the asker nothing — so the agent's chip reported a success the composer had never
    // performed. `reply` is the single exit, so a path that forgets to answer cannot compile away
    // quietly: the asker either hears the outcome or hears the timeout, never silence.
      const reply = (outcome: Outcome): void => {
        emitComposeResult({
          applied: outcome.ok,
          id: request.id,
          paths: outcome.paths,
          reason: outcome.ok ? null : outcome.reason,
          ...(outcome.ok || !outcome.where?.length ? {} : { where: outcome.where }),
        })
      }
      const refuse = (reason: string, where?: string[]): void => {
        setMoveError(reason)
        reply({ ok: false, paths: [], reason, where })
      }

      const roots = buildObjectTree(files)
      const byName = (name: string) => flattenTree(roots).find((node) => node.name === name)

      /*
       * BINDING DATA NAMES A WIDGET, NOT A CONTAINER, so it is answered before the target lookup
       * below — a `target` it does not carry would resolve to undefined and refuse every time with
       * a message about a container nobody mentioned.
       *
       * This is the agent's half of the Data modal, and it reuses that modal's own functions
       * rather than restating them: a divergence between what a person can author and what an
       * agent can is the very gap this op exists to close.
       */
      if (request.op === 'bindData') {
        const node = byName(request.widget)
        const outcome = bindData(request, node, node?.path ? files[node.path] : undefined, authoringNamespace)
        if (!outcome.ok) {
          refuse(outcome.error)
          return
        }
        // The RESTAction FIRST, matching ObjectTreePanel's ordering: the widget's apiRef names it,
        // and a widget pointing at a file the draft does not hold yet is briefly inconsistent.
        if (outcome.created) { emitFileAdd(outcome.created) }
        emitFileEdit({ content: outcome.yaml, path: outcome.path })
        reply({ ok: true, paths: [outcome.path, ...(outcome.created ? [outcome.created.path] : [])] })
        return
      }

      const target = byName(request.target)
      if (!target) {
      // The target is a typo or a name from another draft — but what is being PLACED is still
      // known, so the useful half of the answer survives. For a move whose widget is also missing
      // it does not: "which container accepts a widget the draft does not carry" has no answer, and
      // `acceptedBy` returns nothing rather than guessing a plural from the name.
        const moving = request.op === 'move' ? byName(request.widget) : undefined
        let plural: string | null | undefined
        if (request.op === 'move') {
          plural = moving?.resource
        } else if (request.op === 'addExisting') {
          plural = request.resource
        } else if (request.op === 'addWidget') {
          plural = WIDGET_KINDS[request.kind]?.plural
        } else {
          plural = LAYOUT_KINDS[request.layout as keyof typeof LAYOUT_KINDS]
        }
        refuse(`"${request.target}" is not in this draft`, acceptedBy(roots, plural, moving))
        return
      }
      if (request.op === 'move') {
        const moving = byName(request.widget)
        if (!moving) {
          refuse(`"${request.widget}" is not in this draft`)
          return
        }
        reply(applyMove(moving, target, roots, request.at))
        return
      }
      /*
       * CREATING A WIDGET — the agent's palette drop, and the op whose absence caused the bug this
       * branch set exists to prevent.
       *
       * Validated the way `addContainer` validates its layout and for the same reason: a proposal
       * can name anything. The kind is resolved against the GENERATED CRD table rather than a list
       * written here, so a kind added to the chart is placeable by an agent with no code change —
       * the same property the palette has.
       *
       * REQUIRED ARRAYS DEFAULT TO EMPTY, matching what the drop form does for a person. A Table's
       * `columns` and a chart's `data` are the fields `widgetDataTemplate` fills from a
       * RESTAction's result, so demanding them here would force the agent to hand-write the very
       * thing it is about to bind — and fourteen of the forty-four kinds would be uncreatable
       * again, this time only for the agent.
       */
      if (request.op === 'addWidget') {
        const authored = authorWidget(request, (name) => !!byName(name))
        if (!authored.ok) {
          refuse(authored.error)
          return
        }
        reply(applyAdd(target, request.at, {
          authored: authored.authored,
          kind: 'new',
          name: request.name,
          resource: authored.resource,
          widgetKind: authored.kind,
        }))
        return
      }
      if (request.op === 'addContainer') {
      // Validated against the real map, not cast: a proposal can name anything, and a bogus layout
      // must be refused with a reason rather than coerced into a kind that does not exist.
        const layout = (Object.keys(LAYOUT_KINDS) as (keyof typeof LAYOUT_KINDS)[])
          .find((kind) => kind.toLowerCase() === request.layout.toLowerCase())
        if (!layout) {
          refuse(`"${request.layout}" is not a layout kind — try one of ${Object.keys(LAYOUT_KINDS).join(', ')}`)
          return
        }
        reply(applyAdd(target, request.at, { kind: 'container', layout, resource: LAYOUT_KINDS[layout] }))
        return
      }
      /*
     * DOES THE THING BEING PLACED EXIST? The two branches above already refuse a proposal that
     * names something unreal — a move of a widget not in the draft, a container kind not in
     * LAYOUT_KINDS — and this one, the only branch whose argument is the NAME OF A CR ON THE
     * CLUSTER, accepted whatever it was handed.
     *
     * So an agent could place `tables/pod-sizing` when no such Table exists anywhere. Observed,
     * not hypothesised: the draft gained `resourcesRefs: [tables/pod-sizing]` and an items entry
     * pointing at it, the agent reported "I have added the pod-sizing table", and the page
     * rendered a hole. Nothing errored, because a dangling reference is only discovered by
     * looking at the rendered page — which is why `structureEdit` calls this failure the worst
     * available: it publishes clean.
     *
     * The invariant this restores is the one stated at the top of this handler — an agent cannot
     * place a child a person could not have dragged there. A PERSON cannot do this: the palette
     * and PlaceWidgetModal offer a list of widgets that actually exist, so the gesture is
     * constrained by construction. The agent names a string, and nothing was checking it against
     * the same catalogue. This checks it against exactly that catalogue, so the two paths agree.
     *
     * WHAT THIS ACTUALLY CHECKS, stated precisely because the refusal must not overclaim: the
     * catalogue is snowplow's `/list` under the CALLER'S OWN RBAC, scoped to one namespace. So it
     * answers "is this visible to you here", NOT "does this exist". A widget the author cannot
     * read, or one living in another namespace, is absent from it while being perfectly real.
     *
     * Refusing that case is still right, and the reason is not that the widget is fake: a preview
     * renders under the author's identity, so a widget they cannot see is one they cannot verify,
     * and placing it means publishing a page whose content they were never shown. But the message
     * has to say what was tested — "not visible to you in <ns>" — because "does not exist" would
     * be a false statement about the cluster and would send the author hunting the wrong bug.
     *
     * FAIL CLOSED when the catalogue cannot be read. Failing open would reinstate the defect
     * precisely when the cluster is least well understood, and the cost of being wrong is
     * asymmetric: a refusal is visible and recoverable, a dangling reference is neither.
     */
      /*
       * ASKED ABOUT ONE WIDGET, NOT ABOUT ALL OF THEM.
       *
       * This check first enumerated the category in both namespaces. On a real cluster that is 553
       * objects and ~7100ms, and `requestCompose` gives the composer 4000ms — so it could never
       * answer in time, and every placement timed out reporting "no page composer is open to apply
       * this" on a page whose composer was open. One GET about one name is 111ms, or 58ms when it
       * is absent, and a status code says WHICH: 404 is absence, 403 is permission.
       *
       * WHERE IT LOOKS IS THE OTHER HALF, and getting it wrong was worse than the latency.
       *
       * It consulted the preview sandbox as well as the authoring namespace, reasoning that a
       * draft's objects live there. They do — and so does every OTHER draft's residue, because the
       * sandbox is scratch space, not a catalogue. Asked to build a pod-sizing page, the agent
       * found `tables/pod-sizing-table` sitting there from an earlier recording of this very demo
       * and PLACED it: a five-hour-old table wired to a RESTAction nobody had asked for, reported
       * as "I have added the pod-sizing-table". It rendered nothing.
       *
       * The palette and PlaceWidgetModal both list `authoringNamespace` ALONE. So the sandbox
       * lookup handed the agent something a person cannot reach, which is exactly the invariant at
       * the top of this handler — an agent cannot place a child a person could not have dragged
       * there. THIS draft's own widgets stay placeable, because they are files in the held draft
       * and answer to `byName`; what is refused is another draft's leftovers.
       */
      const drafted = byName(request.name)
      if (!drafted?.drafted) {
        const probe = await widgetExists(snowplowBaseUrl, authoringNamespace, request.resource, request.name)
        if (probe.presence === 'unknown') {
          // Fail closed: a check that could not run is not a check that passed.
          refuse(`cannot confirm "${request.name}" is placeable — ${probe.error}`)
          return
        }
        if (probe.presence === 'forbidden') {
          refuse(`"${request.name}" exists in ${authoringNamespace} but you may not read it — it cannot be placed in a draft you could not preview`)
          return
        }
        if (probe.presence === 'missing') {
          refuse(`no ${request.resource} named "${request.name}" in ${authoringNamespace} — create it before placing it`)
          return
        }
      }
      reply(applyAdd(target, request.at, { kind: 'existing', name: request.name, resource: request.resource }))
    })()
  }), [applyAdd, applyMove, authoringNamespace, files, previewSandboxNamespace, snowplowBaseUrl])

  // A REAL discard: the held draft is dropped in the provider — store, gate arming, undo history —
  // not merely hidden here. Hiding it left the files publishable and refused every later start.
  // This view is torn down by LISTENING, not here, because a discard is also re-announced when a
  // re-apply that was already on the wire lands after it and puts a render back — in the same tick
  // that apply opened its payload, before React has rendered it. So the listener reads the payload
  // as adopted (a ref), not as rendered: the rendered one is still the null of the first discard.
  //
  // `payload.onClose` is the v2 teardown seam: it DELETEs the draft CRs snowplow was serving the
  // live render from. It is epoch-guarded upstream, so a payload replaced while this page was open
  // never double-tears-down.
  useEffect(() => onDraftClose(() => {
    adopted.current?.onClose?.()
    adopted.current = null
    setPayload(null)
  }), [])

  // `?resume=<record>` (Your drafts) and `?adopt=<page-slug>` (Unowned drafts) replaced the draft:
  // what this view kept about the one before goes.
  const onResumed = useCallback(() => setMoveError(null), [])

  // What the body shows: the adopted preview, or — for a page held from before this view mounted —
  // one built from the held files, rather than "No draft open" over a draft that is there.
  const shown = useMemo(() => (mode === 'parked' ? null : payload ?? heldPagePayload({ ...files })), [files, mode, payload])

  const slots = {
    canvas: { airborne, draggingId, files, onSelect: openFile, roots },
    inspector: { files, onSelect: openFile, snowplowBaseUrl },
    palette: { namespace: authoringNamespace, snowplowBaseUrl },
  }

  const workbench: Workbench<typeof slots> = {
    after: (
      /*
        The drop asks what the CRD requires. It is mounted beside the context rather than
        inside it because the gesture is already over: what is left is authoring, and a modal
        inside a DndContext would be a drop target nobody wants.
      */
      <CreateWidgetModal
        onCancel={() => setPendingCreate(null)}
        onCreate={({ name, widgetData }) => {
          if (!pendingCreate) {
            return
          }
          applyAdd(pendingCreate.target, pendingCreate.at, {
            authored: widgetData,
            kind: 'new',
            name,
            resource: WIDGET_KINDS[pendingCreate.widgetKind]?.plural ?? '',
            widgetKind: pendingCreate.widgetKind,
          })
          setPendingCreate(null)
        }}
        open={!!pendingCreate}
        widgetKind={pendingCreate?.widgetKind ?? null}
      />
    ),
    before: (
      <>
        {/*
          EVERY OUTCOME, successes and refusals alike, and mounted unconditionally so the region
          EXISTS before the first edit — assistive technology watches a region it has already seen,
          and one that appears at the same moment as its first message is commonly missed.
          A region that speaks only on failure teaches people to ignore it, and then silence has two
          meanings: it worked, or it did nothing. `role='status'` announces without interrupting.
        */}
        <div aria-live='polite' className={styles.announce} data-testid='composer-announce' role='status'>
          {announcement}
        </div>
        {/* NEW_DRAFT_NAMESPACE, not a namespace read from the draft: there IS no draft yet, which is
            the whole point of this control. It matches what every Autopilot-published page already
            carries, so starting one here and asking the agent for one produce the same bytes. */}
        <StartDraftModal
          namespace={NEW_DRAFT_NAMESPACE}
          onCancel={() => setStarting(false)}
          onStart={(result) => {
            setStarting(false)
            emitDraftStart({ title: 'Page draft', widgets: result.widgets })
          }}
          open={starting}
        />
      </>
    ),
    /*
     * An honest empty state rather than a fake canvas: nothing is being authored yet, and saying so
     * beats rendering an empty page that looks like a failed load. Through `WidgetEmpty` (design rule
     * C14), with the action slot that shared component grew for "Start a page".
     */
    empty: <ComposerEmptyState onDiscard={emitDraftClose} onStart={() => setStarting(true)} parkedBlueprint={mode === 'parked'} />,
    files: { caption: payload?.caption ? LIVE_PREVIEW_CAPTION_INLINE : undefined },
    kind,
    // Why a move can be refused, shown where the other outcomes are shown. Not antd `message`: the
    // composer already reports through Alerts, and a toast that vanishes is the wrong surface for
    // "this drop was rejected and here is why".
    notices: moveError
      ? (
        <Alert
          closable
          onClose={() => setMoveError(null)}
          showIcon
          title={moveError}
          type='warning'
        />
      )
      : null,
    onResumed,
    shown,
    slots,
    title: { meta: '', name: shown?.title ?? '' },
    /*
      ONE CONTEXT OVER BOTH PANELS. A drag that begins in the palette and ends on the canvas is a
      single gesture, so the two cannot each own one — which is also why the drag state lives in
      this workbench rather than in either panel.

      `pointerWithin` rather than the default rectangle intersection: the canvas is nested
      containers, wells inside wells, and rectangle overlap resolves an inner well and its ancestors
      as equally good candidates. Asking which droppable the POINTER is inside is the collision
      strategy dnd-kit documents for nesting, and it is what makes exactly one target light up.
    */
    wrapBody: (body: ReactNode) => (
      <DndContext
        /*
          ANNOUNCEMENTS THAT NAME THINGS, not ids.
          dnd-kit ships English defaults and they work — they just read the identifier, so a
          screen-reader user heard "Draggable item node:card-b:c:0 was moved over droppable
          area well:page-x". The ids are deliberately opaque (a placement needs name AND refId
          AND position to be addressed), which makes them exactly the wrong thing to say out
          loud. The tree's live region already speaks in names; this is the canvas catching up.
        */
        accessibility={{ announcements: dragAnnouncements }}
        collisionDetection={composerCollisions}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
        sensors={sensors}
      >
        {body}
        {/*
          THE DRAG IMAGE. The browser's default was a translucent snapshot of the dragged element —
          so dragging a populated container dragged a copy of its whole subtree across the canvas,
          covering the very drop targets it was being aimed at. A chip says what is in the air and
          occludes nothing. (Not an antd Tag either: see `.dragChip` for what that cost.)
        */}
        <DragOverlay dropAnimation={null}>
          {airborne ? (
            <div className={styles.dragChip}>
              {airborneLabel(airborne)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    ),
  }
  return workbench
}

export type PageSlots = ReturnType<typeof usePageWorkbench>['slots']
