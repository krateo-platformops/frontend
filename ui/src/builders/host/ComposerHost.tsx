/**
 * THE COMPOSER HOST (T4, frontend#410) — one authoring surface for every Builder, configured by its
 * spec and filled by the plugins it names.
 *
 * WHAT IT OWNS, which the Page and Blueprint composers each used to wire by hand:
 *
 * - WHOSE DRAFT IS HELD. The draft broadcast, and a replay asked for on mount so a draft held before
 *   this page opened is shown. A draft of the Builder's kind is drawn; any other is parked behind the
 *   empty state and never read (heldMode.ts).
 * - THE PREVIEW SURFACE CLAIM for the Builder's draft kind while mounted, so the Autopilot drawer
 *   does not open over the same draft — its close would tear down what this page still shows.
 * - THE HEADER. Title and copy from `spec.label` and the draft kind's words; the draft record's save
 *   indicator; Preview · Undo · Publish · Close draft. Preview renders (`preview.mode: render`) or
 *   scrolls to the live result (`sandbox-apply`). Publish asks the provider with the one person-publish
 *   verb the Builder allows — the provider still runs the destination form and the blast-radius
 *   confirm a person answers — and shows its answer. Close draft is confirmed, in useCloseDraftCopy's
 *   words (kept when the draft has a record, discarded when it has none).
 * - RESUME. `?resume=` (and `?adopt=`, for a kind that has a legacy form), held by the provider.
 * - THE FILES PANE: PreviewContent's tabs, the file a slot asked to reveal, and the edit verdicts.
 * - THE FRAME the canvas plugin names (frames.ts), with the palette, canvas and inspector plugins the
 *   Builder names in their slots, each drawing the workbench of the Builder's draft kind.
 *
 * WHAT IT NEVER DOES. It never publishes: Publish only asks. It never reads another kind's files. And a
 * Builder it cannot mount — a plugin, a check or a workbench this build does not ship, or a plugin
 * paired with another kind's workbench — is said in sentences where the composer would have been.
 */
import { Alert, Button, Popconfirm, Space, Tooltip, Typography } from 'antd'
import {
  useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode,
} from 'react'

import type { DraftKind } from '../../components/Autopilot/blueprintDraftStore'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { DraftProblemsAlert } from '../../components/Autopilot/DraftProblemsAlert'
import DraftSaveIndicator, { useCloseDraftCopy } from '../../components/Autopilot/DraftSaveIndicator'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { claimPreviewSurface, onDraftChanged, requestDraftReplay, type DraftChangedDetail } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { emitDraftUndo } from '../../components/Autopilot/previewDraftUndo'
import { emitPublishRequest, onPublishResult, type PublishRequestDetail } from '../../components/Autopilot/previewPublishRequest'
import { PreviewContent, type RestDefVerdicts } from '../../components/Autopilot/previewSurface'
import { useDraftResume } from '../../components/Autopilot/useDraftResume'
import StatusPill from '../../components/StatusPill'
import { ConfigContext } from '../../context/ConfigContext'
import { SplitDivider } from '../../pages/PageComposer/SplitDivider'
import type { Builder } from '../builderSpec'
import { findDraftKindPlugin, type DraftKindNouns } from '../draftKinds'
import { builderRefusals, resolvePlugin } from '../pluginRegistry'

import { FRAME_STYLES } from './frames'
import { heldModeOf } from './heldMode'
import type { CanvasPlugin, HostDraft, SlotPlugin, Workbench, WorkbenchPlugin } from './hostTypes'
import { resolveWorkbench } from './workbenches'

const NOTHING: Record<string, string> = {}
const NOTHING_HELD: DraftChangedDetail = { files: NOTHING, kind: null, problems: [] }

/**
 * The verbs a PERSON's Publish may send (previewPublishRequest). A Builder's publish verb is the one
 * of these its `verbs.allowed` names; the provider then asks the Builder that allows it.
 */
const PERSON_PUBLISH_VERBS: readonly PublishRequestDetail['verb'][] = ['publishPage', 'publishBlueprint']

const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** Everything the host resolved from a Builder before mounting it. */
interface Parts {
  kind: DraftKind
  workbench: WorkbenchPlugin
  nouns: DraftKindNouns
  palette: SlotPlugin
  canvas: CanvasPlugin
  inspector: SlotPlugin
}

/** The Builder's parts, or every reason one of them cannot be mounted. */
const resolveParts = (builder: Builder): { ok: true; parts: Parts } | { ok: false; problems: string[] } => {
  const { spec } = builder
  const problems = builderRefusals(spec)
  const workbench = resolveWorkbench(spec.draftKind)
  if (!workbench.ok) { problems.push(workbench.refusal) }
  const draftKind = findDraftKindPlugin(spec.draftKind)
  if (!draftKind) { problems.push(`This frontend has no words for the draft kind "${spec.draftKind}", so the composer cannot name what it holds.`) }
  const palette = resolvePlugin('palette', spec.palette.plugin)
  const canvas = resolvePlugin('canvas', spec.canvas.plugin)
  const inspector = resolvePlugin('inspector', spec.inspector.plugin)
  // A plugin draws one draft kind's workbench: paired with another, it would read state it was never given.
  for (const resolved of [palette, canvas, inspector]) {
    if (resolved.ok && resolved.implementation.kind !== spec.draftKind) {
      problems.push(`The ${resolved.slot} plugin "${resolved.name}" draws ${resolved.implementation.kind} drafts, and this Builder's draft kind is "${spec.draftKind}" — pair it with a ${resolved.slot} plugin for that kind.`)
    }
  }
  if (problems.length || !workbench.ok || !draftKind || !palette.ok || !canvas.ok || !inspector.ok) {
    return { ok: false, problems }
  }
  return {
    ok: true,
    parts: { canvas: canvas.implementation, inspector: inspector.implementation, kind: workbench.kind, nouns: draftKind.nouns, palette: palette.implementation, workbench: workbench.plugin },
  }
}

/** A Builder this frontend cannot mount: said where the composer would have been. */
const Refused = ({ label, problems }: { label: string; problems: string[] }) => {
  const styles = FRAME_STYLES.panes
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>{`${label} / Compose`}</span>
        <Alert
          description={<ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
          showIcon
          title={`The ${label} cannot be shown by this frontend.`}
          type='error'
        />
      </header>
    </div>
  )
}

const Mounted = ({ builder, parts }: { builder: Builder; parts: Parts }) => {
  const { spec } = builder
  const { kind, nouns } = parts
  const { frame } = parts.canvas
  const styles = FRAME_STYLES[frame]
  // `useContext`, not a throwing hook: a composer mounts bare in tests and degrades without config.
  const api = useContext(ConfigContext)?.config?.api
  const [held, setHeld] = useState<DraftChangedDetail>(NOTHING_HELD)
  // The file a slot asked the files pane to reveal — and a count of the requests, because asking for
  // the SAME file again (after Source, or after scrolling away) must reveal it again.
  const [focus, setFocus] = useState<{ path: string; nonce: number } | null>(null)
  const openFile = useCallback((path: string | null) => setFocus((last) => (path === null ? null : { nonce: (last?.nonce ?? 0) + 1, path })), [])
  // Re-validated verdicts after an applied edit, so the Alert blocks reflect the latest draft.
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)
  const resetVerdicts = useCallback(() => setEditVerdicts(null), [])
  // The publish in flight, and its answer — shown here: the person who pressed Publish is looking at
  // this page, not at the conversation.
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<{ denial: string | null; deepLink: string | null } | null>(null)
  const publishId = useRef<string | null>(null)
  // How many steps back are available — read from the history so the control cannot claim one.
  const undoDepth = useSyncExternalStore(draftHistory.subscribe, draftHistory.depth, draftHistory.depth)
  const blockerId = useId()
  const closeCopy = useCloseDraftCopy(kind)
  const sideRef = useRef<HTMLDivElement>(null)
  // The result, so Preview can take a person to a live render without anyone hunting for it.
  const resultRef = useRef<HTMLElement | null>(null)
  // The `split` frame's canvas share of the centre column. Opens favouring the canvas — you place
  // before you verify — but the result is VISIBLE from the first frame, which is the point.
  const [split, setSplit] = useState(60)
  const workbenchRef = useRef<Workbench | null>(null)

  useEffect(() => claimPreviewSurface(kind), [kind])

  useEffect(() => onDraftChanged(setHeld), [])

  // The answer to OUR publish, ignoring any other surface's.
  useEffect(() => onPublishResult(({ deepLink, denial, id }) => {
    if (publishId.current !== id) {
      return
    }
    publishId.current = null
    setPublishing(false)
    setPublished({ deepLink, denial })
  }), [])

  // A discard — this page's or anyone's: nothing shown describes a held draft any more. What is held
  // is the provider's to broadcast; until it does, this view holds nothing.
  useEffect(() => onDraftClose(() => {
    setHeld(NOTHING_HELD)
    setFocus(null)
    setEditVerdicts(null)
    setPublished(null)
  }), [])

  // A `?resume=` that replaced the draft: the same forgetting, and the workbench's own.
  const onResumed = useCallback(() => {
    setFocus(null)
    setEditVerdicts(null)
    setPublished(null)
    workbenchRef.current?.onResumed()
  }, [])
  const resumed = useDraftResume({
    ...(parts.workbench.allowAdopt ? { allowAdopt: true } : {}),
    kind,
    onResumed,
    sandboxNamespace: api?.PREVIEW_SANDBOX_NAMESPACE,
    snowplowBaseUrl: api?.SNOWPLOW_API_BASE_URL,
  })

  const mode = heldModeOf(held, kind)
  const files = mode === 'own' ? held.files : NOTHING
  const host: HostDraft = { api, builder, files, held, kind, mode, openFile, resetVerdicts, sideRef, spec }
  const workbench = parts.workbench.useWorkbench(host)
  workbenchRef.current = workbench

  // The replay is asked for AFTER every listener is on — the host's above, and the workbench's, which
  // its hook declared just now. The provider answers a replay synchronously, so a listener registered
  // in a later effect would miss the draft that was held before this page mounted (a workbench that
  // plans from the last broadcast would then plan against nothing). Effects run in declaration order.
  useEffect(() => { requestDraftReplay() }, [])

  // The ONE person-publish verb the Builder allows. None, or more than one, and Publish stays off with
  // the reason — which of two publish verbs a Builder meant is never guessed.
  const publishVerbs = useMemo(() => PERSON_PUBLISH_VERBS.filter((verb) => spec.verbs.allowed.includes(verb)), [spec])
  const publishVerb = publishVerbs.length === 1 ? publishVerbs[0] : null
  let verbRefusal: string | null = null
  if (!publishVerbs.length) {
    verbRefusal = `The ${spec.label} allows no publish verb, so nothing here can be published.`
  } else if (publishVerbs.length > 1) {
    verbRefusal = `The ${spec.label} allows ${publishVerbs.join(' and ')} — a Builder publishes with one verb, so nothing here is published until it names one.`
  }
  const publish = () => {
    if (!publishVerb) { return }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    publishId.current = id
    setPublished(null)
    setPublishing(true)
    emitPublishRequest({ id, verb: publishVerb })
  }

  const eyebrow = `${spec.label} / Compose`
  const title = `${capitalized(nouns.composer)} composer`
  const { summary } = parts.workbench
  // What the files pane shows — null when nothing of this Builder's is, and the empty state is.
  const shown = mode === 'parked' ? null : workbench.shown
  const rendering = workbench.preview?.pending ?? false

  // A render preview asks the provider; a live one is already on the page, so Preview takes you there.
  const renders = spec.preview.mode === 'render' && workbench.preview
  const previewButton = renders
    ? <Button loading={rendering} onClick={workbench.preview?.run}>{rendering ? 'Previewing…' : 'Preview'}</Button>
    : <Button onClick={() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Preview</Button>
  const undoButton = <Button disabled={!undoDepth} onClick={() => emitDraftUndo()}>Undo</Button>
  // Confirmed rather than immediate. The provider drops the held draft, not only this view; whether
  // the draft stays stored (close) or goes (discard) is useCloseDraftCopy's to say.
  const closeButton = (
    <Popconfirm cancelText='Keep editing' okText={closeCopy.okText} onConfirm={emitDraftClose} title={closeCopy.title}>
      <Button>Close draft</Button>
    </Popconfirm>
  )
  const publishedAlert = published ? (
    <Alert
      action={published.deepLink
        ? <Button href={published.deepLink} rel='noreferrer' target='_blank' type='link'>Open change request</Button>
        : null}
      closable
      onClose={() => setPublished(null)}
      showIcon
      title={published.denial ?? 'Published — the change request is open for review.'}
      type={published.denial ? 'warning' : 'success'}
    />
  ) : null

  const { Component: Palette } = parts.palette
  const { Component: Canvas } = parts.canvas
  const { Component: Inspector } = parts.inspector
  const wrap = workbench.wrapBody ?? ((node: ReactNode) => node)
  const filesPane = (payload: AutopilotPreviewPayload, hideDraftProblems: boolean) => (
    <PreviewContent
      caption={workbench.files.caption}
      editVerdicts={editVerdicts}
      focusNonce={focus?.nonce}
      focusPath={focus?.path ?? null}
      hideDraftProblems={hideDraftProblems || undefined}
      highlight={workbench.files.highlight}
      liveFiles={files}
      onVerdicts={setEditVerdicts}
      payload={payload}
      sourceNotes={workbench.files.sourceNotes}
    />
  )

  if (frame === 'split') {
    return (
      <div className={styles.page}>
        {workbench.before}
        <header className={styles.head}>
          <Typography.Title level={2} style={{ margin: 0 }}>{title}</Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }} type='secondary'>{summary}</Typography.Paragraph>
          {shown ? (
            <Space className={styles.actions}>
              {/* The draft record's autosave: Saving…, Saved · HH:MM, or Not saved — and why. */}
              <DraftSaveIndicator kind={kind} />
              {previewButton}
              {undoButton}
              {verbRefusal ? (
                // Off, and why — the same anchor and read-aloud reason as the panes frame's gate.
                <Tooltip title={verbRefusal}>
                  <span className={styles.tooltipAnchor}>
                    <Button aria-describedby={blockerId} disabled type='primary'>Publish</Button>
                  </span>
                </Tooltip>
              ) : (
                <Button loading={publishing} onClick={publish} type='primary'>
                  {publishing ? 'Publishing…' : 'Publish'}
                </Button>
              )}
              {closeButton}
            </Space>
          ) : null}
          {shown && verbRefusal ? <span className={styles.srOnly} id={blockerId}>{verbRefusal}</span> : null}
          {resumed}
          {workbench.notices}
          {publishedAlert}
        </header>
        {shown ? (
          <>
            {wrap(
              /* BUILD ABOVE, RESULT BELOW — and exactly one tab bar on the page: the files pane's. */
              <div className={styles.build}>
                <section className={styles.palette}><Palette workbench={workbench} /></section>
                {/* PLACE ABOVE, VERIFY BELOW — see SplitDivider for what a result off-screen cost. */}
                <div className={styles.centre} style={{ '--split': `${split}%` } as CSSProperties}>
                  <section className={styles.canvas}><Canvas workbench={workbench} /></section>
                  <SplitDivider onChange={setSplit} value={split} />
                  <div className={styles.result} ref={(element) => { resultRef.current = element }}>
                    {filesPane(shown, false)}
                  </div>
                </div>
                <div className={styles.structure}><Inspector workbench={workbench} /></div>
              </div>,
            )}
            {workbench.after}
          </>
        ) : workbench.empty}
      </div>
    )
  }

  if (!shown) {
    return (
      <div className={styles.page}>
        {workbench.before}
        <header className={styles.head}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1 className={styles.pageTitle}>{title}</h1>
          <p className={styles.subtitle}>{summary}</p>
        </header>
        {resumed}
        {workbench.empty}
      </div>
    )
  }

  // Why Publish is off, in the order a person would fix it — or null when it is on.
  const problems = held.problems?.length ?? 0
  let blocker: string | null = null
  if (verbRefusal) {
    blocker = verbRefusal
  } else if (rendering) {
    blocker = 'Wait for the preview to finish.'
  } else if (problems) {
    blocker = `Fix the ${counted(problems, 'problem')} listed above first — a ${nouns.short} that fails the lint cannot be published.`
  } else if (held.previewed !== true) {
    blocker = `Preview needed — publishing stays off until Preview has rendered the ${nouns.short} exactly as it is now.`
  }
  const { meta, name } = workbench.title

  return (
    <div className={styles.page}>
      {workbench.before}
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1 className={styles.title}>
              {name}
              {meta ? <>{' '}<span className={styles.titleMeta}>{meta}</span></> : null}
            </h1>
          </div>
          <span className={styles.spacer} />
          {/* The draft record's autosave: Saving…, Saved · HH:MM, or Not saved — and why. */}
          <DraftSaveIndicator kind={kind} />
          {/* A count, with no cap to measure it against (frontend#367). */}
          <span className={styles.countPill} title='Files held in the draft'>{counted(Object.keys(files).length, 'file')}</span>
          {/* The EXCEPTION only (status indicators are exception-only): nothing marks a draft whose
              preview stands. `previewed` absent means unknown — no claim either way. */}
          {held.previewed === false ? <StatusPill color='warning' label='Preview needed' /> : null}
          <Space wrap>
            {previewButton}
            {undoButton}
            {/* The Tooltip holds a SPAN, not the button: it writes its own aria-describedby onto
                its child (the popup's id, and only while open), which would replace the button's
                reference to the always-present reason below. */}
            <Tooltip title={blocker}>
              <span className={styles.tooltipAnchor}>
                <Button
                  aria-describedby={blocker ? blockerId : undefined}
                  disabled={!!blocker}
                  loading={publishing}
                  onClick={publish}
                  type='primary'
                >
                  {publishing ? 'Publishing…' : 'Publish'}
                </Button>
              </span>
            </Tooltip>
            {closeButton}
          </Space>
          {blocker ? <span className={styles.srOnly} id={blockerId}>{blocker}</span> : null}
        </div>
        {resumed}
        <DraftProblemsAlert problems={held.problems ?? []} />
        {workbench.notices}
        {publishedAlert}
      </header>

      {wrap(
        <div className={styles.body}>
          <Palette workbench={workbench} />
          <div className={styles.centre}>
            <Canvas workbench={workbench} />
            {/* The draft's files | Source. Editable in place; each accepted edit rides the file-edit
                bus into the held draft, and turns Publish off until the next Preview. */}
            <section
              aria-label={`${capitalized(nouns.short)} files and Source`}
              className={`${styles.pane} ${styles.filesPane}`}
              ref={(element) => { resultRef.current = element }}
            >
              <div className={styles.section}>
                {filesPane(shown, true)}
              </div>
            </section>
          </div>
          <div className={styles.side} ref={sideRef}>
            <Inspector workbench={workbench} />
          </div>
        </div>,
      )}
      {workbench.after}
    </div>
  )
}

/**
 * The composer for one Builder. `undefined` — no Builder answers where one was asked for — is said,
 * like any Builder that cannot be mounted.
 */
export const ComposerHost = ({ builder, name }: { builder: Builder | undefined; name?: string }) => {
  const resolved = useMemo(() => (builder ? resolveParts(builder) : null), [builder])
  if (!builder || !resolved) {
    return <Refused label={name ?? 'builder'} problems={[`No Builder named "${name ?? ''}" is loaded, so there is nothing to compose with.`]} />
  }
  if (!resolved.ok) {
    return <Refused label={builder.spec.label} problems={resolved.problems} />
  }
  // Keyed by the Builder: another Builder is another workbench, whose hooks are its own.
  return <Mounted builder={builder} key={builder.metadata.name} parts={resolved.parts} />
}

export default ComposerHost
