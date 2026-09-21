/**
 * Page Composer — the Portal Builder's authoring surface, mounted as a page.
 *
 * WHAT THIS IS. The same surface Autopilot opens when it previews a draft: the live render, the
 * Files tab with its per-file editor, the RestDefinition editor, the validation verdicts. Until now
 * that existed only as `AutopilotPreviewDrawer`, which `AutopilotProvider` renders — so the whole
 * authoring surface was reachable exclusively through the rail, as something the AGENT opens.
 *
 * WHY THAT MATTERED. The Portal Builder could not use any of it, so it reimplemented a slice
 * through Form widgets: `compose-page` and `author-widget`. A Form cannot express a tree and
 * `SchemaFields` has no repeatable-row control, so those two can only emit a FLAT page of widgets
 * with STATIC widgetData — no Rows, Cols, Tabs, no `apiRef`, no `widgetDataTemplate`. That locks
 * the builder out of the half of the corpus that computes its data server-side (212 of 425 shipped
 * widget templates carry a `widgetDataTemplate`). The chart predicted it in
 * restaction.page-composable: "an editor that authors NEW widgets from static widgetData can only
 * produce the trivial ones — it would look finished and ship pages nobody wants."
 *
 * WHY A STATIC ROUTE AND NOT A WIDGET KIND. `/profile` is the precedent: a static child of the
 * shell route, rendering inside the same chrome, with `*` falling through to `WidgetPage` for
 * everything CR-driven. So this needs a frontend image and nothing else — no new widget kind, no
 * CRD, no installer pin, none of the 4-piece release the parity programme's B3 assumed by its name.
 *
 * WHAT IT DOES NOT CHANGE. Autopilot is untouched and loses nothing: it still proposes drafts onto
 * the same CustomEvent bus, and its drawer still opens. The only difference is that a human can now
 * start one. Publishing is unchanged and still ends at a form a person submits — the agent's
 * never-submit guarantee is not weakened by any of this.
 */
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { Alert, Button, Popconfirm, Space, Typography } from 'antd'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { emitComposeResult, onComposeRequest } from '../../components/Autopilot/composeRequest'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { AUTOPILOT_PREVIEW_EVENT } from '../../components/Autopilot/previewBus'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { claimPreviewSurface, onDraftChanged, requestDraftReplay } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftStart } from '../../components/Autopilot/previewDraftStart'
import { emitDraftUndo } from '../../components/Autopilot/previewDraftUndo'
import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFileEdit } from '../../components/Autopilot/previewFileEdit'
import { emitPublishRequest, onPublishResult } from '../../components/Autopilot/previewPublishRequest'
import { PreviewContent } from '../../components/Autopilot/previewSurface'
import type { RestDefVerdicts } from '../../components/Autopilot/previewSurface'
import { WidgetEmpty } from '../../components/WidgetStates'
import { ConfigContext } from '../../context/ConfigContext'

import CanvasPanel from './CanvasPanel'
import { announce, onAnnounce } from './composerAnnounce'
import CreateWidgetModal from './CreateWidgetModal'
import { resolveDrop } from './dndIds'
import type { DragPayload, DropPayload } from './dndIds'
import { legalTargets } from './dropTargets'
import { buildObjectTree, draftNamespace, flattenTree } from './objectTree'
import type { TreeNode } from './objectTree'
import ObjectTreePanel from './ObjectTreePanel'
import styles from './PageComposer.module.css'
import PalettePanel from './PalettePanel'
import type { PalettePick } from './PalettePanel'
import { planAdd } from './planAdd'
import { planMove } from './planMove'
import { SplitDivider } from './SplitDivider'
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

const PageComposer = () => {
  // `useContext`, not `useConfigContext`: the hook throws with no provider above it, and this page
  // only DEGRADES without config — the widget picker reports that it cannot reach the list. Taking
  // the whole route down for that would be worse, and the page is asserted to mount bare.
  const snowplowBaseUrl = useContext(ConfigContext)?.config?.api?.SNOWPLOW_API_BASE_URL ?? ''
  const [payload, setPayload] = useState<AutopilotPreviewPayload | null>(null)
  // Canvas's share of the centre column. Opens favouring the canvas — you place before you
  // verify — but the preview is VISIBLE from the first frame, which is the point.
  const [split, setSplit] = useState(60)
  /**
   * The draft AS IT IS NOW, keyed by held key — not `payload.files`.
   *
   * This was the bug that invalidated everything built on top of it. The preview payload is built
   * once, by the verb that proposed the draft, and nothing re-emits it; a tree that read its bytes
   * from there computed every structural edit against the file as it was when the draft was FIRST
   * previewed. Two edits to the same parent and the second silently reverted the first, because
   * both were derived from the same original — and the tree never redrew to show it.
   *
   * The store in the provider is the source of truth, so the tree re-reads from its broadcast. Held
   * KEYS rather than displayed paths: what the tree emits back are writes, and a write addressed by
   * the routed path is a path that gets routed twice.
   */
  const [files, setFiles] = useState<Record<string, string>>({})
  // Why a move can be refused, shown where the other outcomes are shown. Not antd `message`: the
  // composer already reports through Alerts, and a toast that vanishes is the wrong surface for
  // "this drop was rejected and here is why".
  const [moveError, setMoveError] = useState<string | null>(null)

  /**
   * What is in the air, from EITHER panel, and the dnd-kit id of the thing being dragged.
   *
   * Lifted here because a drag that starts in the palette and ends on the canvas is one gesture
   * across two siblings, so the `DndContext` has to enclose both — and the state it produces
   * belongs at the same level.
   */
  /** How many steps back are available — read from the history so the control cannot claim one. */
  const undoDepth = useSyncExternalStore(draftHistory.subscribe, draftHistory.depth, draftHistory.depth)
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
  // The tree selection, reflected in the Files list. Without it the two halves of the page are
  // unrelated views of the same draft.
  const [focusPath, setFocusPath] = useState<string | null>(null)
  // The publish in flight, and its outcome. Held here rather than shown in the chat rail: the
  // person who pressed the button is looking at this page, and sending them to the conversation to
  // find out what happened is the coupling this whole surface exists to remove.
  const [publishing, setPublishing] = useState(false)
  const [outcome, setOutcome] = useState<{ denial: string | null; deepLink: string | null } | null>(null)
  const publishId = useRef<string | null>(null)
  /** The result panel, so the header can take you to it without anyone hunting for it. */
  const resultRef = useRef<HTMLDivElement | null>(null)
  // Re-validated verdicts after an applied edit, so the Alert blocks reflect the latest draft
  // rather than the one that was first handed over. Same contract the drawer keeps.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)

  // The SAME bus the drawer listens on. A preview proposed by Autopilot while this page is open
  // therefore lands here too — which is the point: one draft, two doors. Deliberately not a
  // separate channel; a second bus would be a second source of truth about what is being authored.
  // Claim the preview while this page is mounted, so the drawer does not ALSO open on the same
  // payload. Two surfaces on one draft is not just redundant: the drawer's close fires the sandbox
  // teardown, which deletes the draft CRs this page is still rendering live.
  useEffect(() => claimPreviewSurface(), [])

  useEffect(() => {
    const onPreview = (event: CustomEvent<AutopilotPreviewPayload>) => {
      setPayload(event.detail)
      setEditVerdicts(null)
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview as EventListener)
  }, [])

  // The answer to OUR publish, ignoring any other surface's.
  useEffect(() => onPublishResult(({ deepLink, denial, id }) => {
    if (publishId.current !== id) {
      return
    }
    publishId.current = null
    setPublishing(false)
    setOutcome({ deepLink, denial })
  }), [])

  // The held draft, and a replay request for the case this page mounted after it was seeded —
  // navigate here with a draft already open and the tree would otherwise sit empty until the next
  // edit, describing a draft that exists as if it did not.
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
    reply(applyAdd(target, request.at, { kind: 'existing', name: request.name, resource: request.resource }))
  }), [applyAdd, applyMove, files])

  useEffect(() => {
    const stop = onDraftChanged(({ files: next }) => setFiles(next))
    requestDraftReplay()
    return stop
  }, [])

  /**
   * Close the draft — and with it the sandbox.
   *
   * `payload.onClose` is the v2 teardown seam: it DELETEs the draft CRs snowplow was serving the
   * live render from. It is epoch-guarded upstream, so a payload replaced while this page was open
   * never double-tears-down. Clearing local state after it is what returns the honest empty state
   * rather than leaving a dead endpoint mounted.
   */
  /**
   * Publish — the same `runDraftPublish` the agent's verb takes, asked for by a person.
   *
   * The destination form and the blast-radius confirm both still run, so this button PROPOSES the
   * write; it does not perform one. What it removes is the detour: until now the only way to ship
   * a draft you had authored here was to go and ask the agent to emit a publish directive.
   */
  const publish = () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    publishId.current = id
    setOutcome(null)
    setPublishing(true)
    emitPublishRequest({ id, verb: 'publishPage' })
  }

  const closeDraft = () => {
    payload?.onClose?.()
    setPayload(null)
    setEditVerdicts(null)
    setFiles({})
    setFocusPath(null)
  }

  return (
    <div className={styles.page}>
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
      <header className={styles.head}>
        <Typography.Title level={2} style={{ margin: 0 }}>Page composer</Typography.Title>
        <Typography.Paragraph style={{ margin: 0 }} type='secondary'>
          Author a page and everything it needs — widgets, layout and the RESTActions behind
          them — then publish the whole set as one change request.
        </Typography.Paragraph>
        {/* Closing is the sandbox TEARDOWN, which this page now owns: it took the claim, so the
            drawer that used to carry this control never opens here. Confirmed rather than
            immediate, because the draft is not recoverable and nothing else in view says so. */}
        {payload
          ? (
            <Space className={styles.actions}>
              {/*
                THE PREVIEW IS TWENTY SCREENS DOWN, and build-above/result-below is still the right
                reading order — a page builder that put the render between the palette and the
                canvas would be worse. What it costs is the feedback loop that makes direct
                manipulation worth having: you edit, and then you go and look, which is the loop
                direct manipulation exists to remove.
                This is the cheap eighty percent of fixing that. A sticky strip or a split with a
                draggable divider would be better and takes vertical space from the canvas, which
                is the scarcest thing on this page — that is a layout decision, not a defect fix.
              */}
              <Button
                onClick={() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Preview
              </Button>
              {/*
                UNDO. The composer had none, which was merely expensive while every operation was
                recoverable by hand — and two were not. Remove is now genuinely destructive (it
                deletes the file rather than orphaning it), so this is the control that makes that
                safe rather than merely confirmed. It steps the WHOLE held tree back, so it covers
                a container drop that both added a file and rewrote a parent, a hand edit in the
                Files tab, and the agent's own compose edits alike.
              */}
              <Button disabled={!undoDepth} onClick={() => emitDraftUndo()}>
                Undo
              </Button>
              <Button loading={publishing} onClick={publish} type='primary'>
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
              <Popconfirm
                cancelText='Keep editing'
                okText='Discard'
                onConfirm={closeDraft}
                title='Discard this draft? The sandbox and its unpublished files are deleted.'
              >
                <Button>Close draft</Button>
              </Popconfirm>
            </Space>
          )
          : null}
        {moveError
          ? (
            <Alert
              closable
              onClose={() => setMoveError(null)}
              showIcon
              title={moveError}
              type='warning'
            />
          )
          : null}
        {outcome
          ? (
            <Alert
              action={outcome.deepLink
                ? <Button href={outcome.deepLink} rel='noreferrer' target='_blank' type='link'>Open change request</Button>
                : null}
              closable
              onClose={() => setOutcome(null)}
              showIcon
              title={outcome.denial ?? 'Published — the change request is open for review.'}
              type={outcome.denial ? 'warning' : 'success'}
            />
          )
          : null}
      </header>

      {payload
        ? (
          /*
           * BUILD ABOVE, RESULT BELOW — and exactly one tab bar on the page.
           *
           * WHAT THIS REPLACES. The composer used to face two tab bars at each other: the preview
           * surface carried Rendered|Files|Source on the left, a rail carried Structure|Canvas on
           * the right. Neither named the same axis, nothing said which bar a given view lived in,
           * and the CANVAS — the thing you manipulate — was in the 320px rail while the read-mostly
           * preview held the wide column. The palette had to be folded into a wrapping strip above
           * the canvas just to fit beside it.
           *
           * THE ORDER NOW FOLLOWS THE WORK. The top row is the builder and everything in it is a
           * tool: pick something (palette), place it (canvas), operate on it (tree). All three are
           * mounted at once, which is not a preference — a drag cannot cross a tab boundary, so the
           * palette and the canvas MUST share a screen; and the tree is not a view of the canvas
           * but the keyboard-operable route to the same edits (move, wrap, add inside, remove,
           * bind), so hiding it behind a tab would take those controls away from anyone not using a
           * pointer. Below sits the one thing that is genuinely a set of VIEWS of the result, and
           * it keeps its own tab bar — now the only one.
           */
          <>
            {/*
              ONE CONTEXT OVER BOTH PANELS. A drag that begins in the palette and ends on the canvas
              is a single gesture, so the two cannot each own one — which is also why the drag state
              lives in this component rather than in either panel.

              `pointerWithin` rather than the default rectangle intersection: the canvas is nested
              containers, wells inside wells, and rectangle overlap resolves an inner well and its
              ancestors as equally good candidates. Asking which droppable the POINTER is inside is
              the collision strategy dnd-kit documents for nesting, and it is what makes exactly one
              target light up instead of six.
            */}
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
              <div className={styles.build}>
                <section className={styles.palette}>
                  <Typography.Text strong>Add</Typography.Text>
                  <PalettePanel
                    namespace={authoringNamespace}
                    snowplowBaseUrl={snowplowBaseUrl}
                  />
                </section>

                {/*
                  PLACE ABOVE, VERIFY BELOW. The preview used to sit under the whole builder row,
                  where a short draft left it off-screen — see SplitDivider for what that cost.
                */}
                <div className={styles.centre} style={{ '--split': `${split}%` } as React.CSSProperties}>
                  <section className={styles.canvas}>
                    <Typography.Text strong>Layout</Typography.Text>
                    <CanvasPanel
                      airborne={airborne}
                      draggingId={draggingId}
                      files={files}
                      onSelect={setFocusPath}
                      roots={roots}
                    />
                  </section>
                  <SplitDivider onChange={setSplit} value={split} />
                  <div className={styles.result} ref={resultRef}>
                    <PreviewContent editVerdicts={editVerdicts} focusPath={focusPath} liveFiles={files} onVerdicts={setEditVerdicts} payload={payload} />
                  </div>
                </div>

                {/* Draws its own box and heading — see .structure for why it is not wrapped in one. */}
                <div className={styles.structure}>
                  <ObjectTreePanel files={files} onSelect={setFocusPath} snowplowBaseUrl={snowplowBaseUrl} />
                </div>
              </div>
              {/*
              THE DRAG IMAGE. The browser's default was a translucent snapshot of the dragged
              element — so dragging a populated container dragged a copy of its whole subtree across
              the canvas, covering the very drop targets it was being aimed at. A chip says what is
              in the air and occludes nothing.

              The chip itself then went too far the other way: an antd Tag, 27px wide, translucent,
              sitting exactly on the label it was hovering. See `.dragChip` for what that cost.
            */}
              <DragOverlay dropAnimation={null}>
                {airborne ? (
                  <div className={styles.dragChip}>
                    {airborneLabel(airborne)}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
            {/*
              The drop asks what the CRD requires. It is mounted beside the context rather than
              inside it because the gesture is already over: what is left is authoring, and a modal
              inside a DndContext would be a drop target nobody wants.
            */}
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

            {/* Full width, because the live render is a page and a page wants the width. Selecting
                a node above still reveals its bytes in Files here — same `focusPath` as before. */}
          </>
        )
        : (
          /*
           * An honest empty state rather than a fake canvas: nothing is being authored yet, and
           * saying so beats rendering an empty page that looks like a failed load.
           *
           * THROUGH `WidgetEmpty`, not a hand-rolled `<Empty>` — design rule C14. This page used to
           * roll its own because the shared one had no action slot and the state needs a "Start a
           * page" button; the slot was added rather than the rule worked around, so a future change
           * to the empty treatment reaches here too.
           *
           * ONE SENTENCE, because it used to say the same thing twice. The description ended
           * "...you review every file before it is published" and a second paragraph under the
           * button ended "...nothing is published until you submit the change request yourself" —
           * the same guarantee, restated. P16: say what to do next, do not fill space.
           */
          <WidgetEmpty
            description='No draft open. Start a page here, or ask Autopilot to draft one — either way you review every file before anything is published.'
          >
            <Button onClick={() => setStarting(true)} type='primary'>Start a page</Button>
          </WidgetEmpty>
        )}
    </div>
  )
}

export default PageComposer
