/**
 * Blueprint Composer — the Blueprint Builder's authoring surface, mounted as a page.
 *
 * WHAT THIS IS. A chart and the file that describes it: its resources, what depends on what, and
 * the states it moves through — drawn as a graph, stepped as a machine, and published as one change
 * request. Until now a blueprint could be authored only by asking Autopilot; this is the same draft,
 * started and previewed by a person. (DEMO.md's parity table recorded the Blueprint Builder as the
 * one surface with no UI-native path.)
 *
 * MOUNTED EXACTLY AS THE PAGE COMPOSER, and for the same reasons (PageComposer.tsx): the held draft
 * arrives on the draft broadcast, a replay is asked for on mount so a chart held before this page
 * opened is shown, and the preview surface is CLAIMED for blueprints while the page is mounted, so
 * the drawer does not open over it on the same draft. It WRITES only through the window buses —
 * start, preview, file edit/add, the files batch, undo, close, publish — so it mounts bare, with no
 * AutopilotProvider above it.
 *
 * WHAT IT READS, AND AS WHOM. Two things, both through snowplow `/call` under the person's own
 * credential, never a service identity: the palette (the portal's `blueprint-palette` RESTAction —
 * what this person may place) and, when a custom kind or a blueprint is placed, its CRD (the spec
 * fields its template starts with). A denial is a sentence where the answer would have been. The
 * render is still the provider's.
 *
 * PLACING (screens 4 and 5) is one gesture on a palette row, and one batch: the node in
 * templates/architecture.yaml and its `templates/<id>.yaml`, written together or not at all
 * (planPlace, previewFilesBatch). Like every write, it turns Publish off until Preview renders the
 * chart again. The form editor (screen 10) writes values.schema.json on the file-edit bus.
 *
 * WHAT IT NEVER DOES. It never reads a PAGE draft as a chart (a page set carries Chart.yaml too) —
 * it parks one, named. It never publishes: Publish asks the provider, which runs the destination
 * form and the blast-radius confirm a person answers. And Publish is on only after a Preview has
 * rendered exactly the bytes held now — any edit turns it off again (S3 decision 2, "Preview needed").
 * Autopilot is never asked to do any of it.
 *
 * NOT YET (S4b): drawing an edge, editing what a node waits for, generating the lookup gates. Those
 * are changed today in templates/architecture.yaml in Chart files; the canvas and the machine follow.
 */
import { Alert, Button, Popconfirm, Space, Tooltip } from 'antd'
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { CHART_YAML_PATH, VALUES_SCHEMA_PATH, chartYamlName, chartYamlVersion, draftDisplayName } from '../../components/Autopilot/blueprintDraft'
import { resolveBuilderTarget } from '../../components/Autopilot/builderTargets'
import { extractCrdSpecFields, type CrdSpecExtract } from '../../components/Autopilot/describeResource'
import { draftHistory } from '../../components/Autopilot/draftHistory'
import { DraftProblemsAlert } from '../../components/Autopilot/DraftProblemsAlert'
import { AUTOPILOT_PREVIEW_EVENT, isBlueprintDraftPayload, type AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { claimPreviewSurface, onDraftChanged, requestDraftReplay, type DraftChangedDetail } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { emitDraftUndo } from '../../components/Autopilot/previewDraftUndo'
import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFilesBatch } from '../../components/Autopilot/previewFilesBatch'
import { emitPublishRequest, onPublishResult } from '../../components/Autopilot/previewPublishRequest'
import { PreviewContent, type RestDefVerdicts } from '../../components/Autopilot/previewSurface'
import StatusPill from '../../components/StatusPill'
import { ConfigContext } from '../../context/ConfigContext'

import {
  ARCHITECTURE_API_VERSION,
  ARCHITECTURE_KIND,
  ARCHITECTURE_TEMPLATE_PATH,
  serializeArchitecture,
  wrapAsConfigMapTemplate,
  type ResourceNode,
} from './architecture'
import ArchitectureCanvas from './ArchitectureCanvas'
import ArchitecturePalette from './ArchitecturePalette'
import { architectureView, counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import BlueprintEmptyState from './BlueprintEmptyState'
import FormEditorDrawer from './FormEditorDrawer'
import { heldBlueprintPayload, lastRenderOf, renderCaption, sameFiles } from './heldBlueprintPayload'
import NodeInspector from './NodeInspector'
import type { PaletteRow } from './paletteModel'
import { placementCrd, planPlace, setForEach } from './planPlace'
import { renderOutcomeCopy } from './renderOutcome'
import type { FormFieldType } from './schemaEdit'
import { compositionKind } from './startChart'
import StartChartModal from './StartChartModal'
import StatePanel from './StatePanel'
import { stepperModel, type StepperModel } from './stepperModel'
import { useChartRequests } from './useChartRequests'
import { useCrdSchema } from './useCrdSchema'

export const EYEBROW = 'Blueprint Builder / Compose'

const NOTHING: Record<string, string> = {}
const NO_RESOURCES: ResourceNode[] = []

type Mode = 'empty' | 'page' | 'blueprint'

/**
 * WHOSE DRAFT IS HELD. `kind` on the broadcast says; a detail with no `kind` is a legacy emitter,
 * which only ever held pages — so files with no kind read as a page, and are parked.
 */
const modeOf = ({ files, kind }: DraftChangedDetail): Mode => {
  if (kind === 'blueprint') {
    return 'blueprint'
  }
  if (kind === 'page' || (kind === undefined && Object.keys(files).length > 0)) {
    return 'page'
  }
  return 'empty'
}

/** Why Publish is off, in the order a person would fix it — or null when it is on. */
const publishBlocker = (held: DraftChangedDetail, rendering: boolean): string | null => {
  if (rendering) {
    return 'Wait for the preview to finish.'
  }
  const problems = held.problems?.length ?? 0
  if (problems) {
    return `Fix the ${counted(problems, 'problem')} listed above first — a chart that fails the lint cannot be published.`
  }
  if (held.previewed !== true) {
    return 'Preview needed — publishing stays off until Preview has rendered the chart exactly as it is now.'
  }
  return null
}

const BlueprintComposer = () => {
  // `useContext`, not a throwing hook: the page mounts bare in tests and degrades without config —
  // config supplies the owner the Start modal shows a location under, and the snowplow URL the
  // palette's CRD reads go to.
  const api = useContext(ConfigContext)?.config?.api
  const { owner } = resolveBuilderTarget(api?.AUTOPILOT_BLUEPRINT_BUILDER_REPO)
  const crds = useCrdSchema(api?.SNOWPLOW_API_BASE_URL)
  const [held, setHeld] = useState<DraftChangedDetail>({ files: NOTHING, kind: null, problems: [] })
  const [startOpen, setStartOpen] = useState(false)
  const [level, setLevel] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  // The file Chart files reveals — and a count of the requests, because asking for the SAME file
  // again (after Source, or after scrolling away) must reveal it again (PreviewContent's focusNonce).
  const [focus, setFocus] = useState<{ path: string; nonce: number } | null>(null)
  const openFile = useCallback((path: string) => setFocus((last) => ({ nonce: (last?.nonce ?? 0) + 1, path })), [])
  const [editVerdicts, setEditVerdicts] = useState<RestDefVerdicts | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<{ denial: string | null; deepLink: string | null } | null>(null)
  const publishId = useRef<string | null>(null)
  const requests = useChartRequests()
  const { adopt, reset } = requests
  const undoDepth = useSyncExternalStore(draftHistory.subscribe, draftHistory.depth, draftHistory.depth)
  const blockerId = useId()
  // Placing: the row in flight, why the last one did not land, and what the node just placed says.
  const [placing, setPlacing] = useState<string | null>(null)
  const [placeRefusal, setPlaceRefusal] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ id: string; specNote?: string } | null>(null)
  const [formEditor, setFormEditor] = useState<{ open: boolean; addType: FormFieldType | null; nonce: number }>({ addType: null, nonce: 0, open: false })

  // The blueprint claim, released on unmount — see previewDraftChanged's claimPreviewSurface.
  useEffect(() => claimPreviewSurface('blueprint'), [])

  useEffect(() => {
    const stop = onDraftChanged(setHeld)
    requestDraftReplay()
    return stop
  }, [])

  // The agent's previewBlueprint of the HELD chart: the drawer defers it here while this page holds
  // the claim, so this page is the only place it can be seen.
  useEffect(() => {
    const onPreview = (event: Event): void => {
      const payload = (event as CustomEvent<AutopilotPreviewPayload>).detail
      if (payload && isBlueprintDraftPayload(payload)) {
        adopt(lastRenderOf(payload))
      }
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
  }, [adopt])

  // The answer to OUR publish, ignoring any other surface's — PageComposer's contract.
  useEffect(() => onPublishResult(({ deepLink, denial, id }) => {
    if (publishId.current !== id) {
      return
    }
    publishId.current = null
    setPublishing(false)
    setPublished({ deepLink, denial })
  }), [])

  // A discard — this page's, or anyone's: nothing shown here describes what is held any more.
  useEffect(() => onDraftClose(() => {
    reset()
    setSelected(null)
    setFocus(null)
    setLevel(0)
    setEditVerdicts(null)
    setPublished(null)
    setPlaced(null)
    setPlaceRefusal(null)
    setFormEditor((last) => ({ ...last, open: false }))
  }), [reset])

  const mode = modeOf(held)
  // A page draft's files are never read here, not even to count them.
  const files = mode === 'blueprint' ? held.files : NOTHING
  // What a placement plans from once its CRD read lands — the files as they are THEN, not as they
  // were when the row was pressed (the batch's `expect` refuses a plan made from stale bytes anyway).
  const filesRef = useRef(files)
  filesRef.current = files

  // The Start modal belongs to the empty page: once anything is held — the start landed, or a draft
  // arrived from elsewhere — it closes, and does not come back when that draft is discarded.
  useEffect(() => {
    if (mode !== 'empty') { setStartOpen(false) }
  }, [mode])

  // Keyed on the file's TEXT (a string), not on `files` — see architectureView's header.
  const architectureText = files[ARCHITECTURE_TEMPLATE_PATH]
  const view = useMemo(() => architectureView(architectureText), [architectureText])
  const steps = useMemo((): StepperModel[] => {
    if (view.status !== 'ok') {
      return []
    }
    const total = Math.max(1, view.derived.states.length)
    return Array.from({ length: total }, (_, index) => stepperModel(view.architecture, view.derived, index))
  }, [view])
  const model = steps.length ? steps[Math.min(level, steps.length - 1)] : null
  const architecture = view.status === 'ok' || view.status === 'cycle' ? view.architecture : null
  const selectedNode = architecture?.resources.find((node) => node.id === selected) ?? null

  // Own keys only: a template path named `constructor` is not a file this chart holds.
  const hasFile = useCallback((path: string) => Object.prototype.hasOwnProperty.call(files, path), [files])

  // A node, from the canvas: the inspector shows it, and Chart files opens its template — when the
  // chart has one (the inspector says so when it does not).
  const select = useCallback((id: string) => {
    setSelected(id)
    setPlaced((last) => (last?.id === id ? last : null))
    const node = architecture?.resources.find((resource) => resource.id === id)
    if (node && hasFile(node.template)) { openFile(node.template) }
  }, [architecture, hasFile, openFile])

  const addDescriptor = () => {
    const chart = chartYamlName(files[CHART_YAML_PATH]) ?? draftDisplayName(files)
    const descriptor = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart, kind: ARCHITECTURE_KIND, resources: [] })
    emitFileAdd({ content: wrapAsConfigMapTemplate(descriptor, chart), path: ARCHITECTURE_TEMPLATE_PATH })
    openFile(ARCHITECTURE_TEMPLATE_PATH)
  }

  // PLACE a palette row: the kernel's preflight (no descriptor, the chart nested into itself) before
  // any read, the CRD read for a kind that has one, then one batch. The node is selected and its
  // template revealed.
  const place = useCallback(async (row: PaletteRow) => {
    if (placing) { return }
    setPlaceRefusal(null)
    const preflight = planPlace(filesRef.current, row.pick, null)
    if (!preflight.ok) {
      setPlaceRefusal(preflight.reason)
      return
    }
    const crd = placementCrd(row.pick)
    let spec: CrdSpecExtract | null = null
    let specNote: string | undefined
    if (crd) {
      setPlacing(row.key)
      const read = await crds.read(crd.name)
      setPlacing(null)
      spec = 'crd' in read ? extractCrdSpecFields(read.crd, crd.version) : null
      if ('error' in read) {
        specNote = read.error
      } else if (!spec) {
        specNote = `it declares no spec schema at ${crd.version}`
      }
    }
    const plan = planPlace(filesRef.current, row.pick, spec, specNote)
    if (!plan.ok) {
      setPlaceRefusal(plan.reason)
      return
    }
    const outcome = emitFilesBatch({ add: plan.add, edit: plan.edit, expect: plan.expect, kind: 'blueprint' })
    if (!outcome?.ok) {
      setPlaceRefusal(`Nothing was placed — ${outcome ? outcome.error : 'no provider answered, so the draft did not change'}`)
      return
    }
    setSelected(plan.id)
    setPlaced({ id: plan.id, specNote })
    openFile(`templates/${plan.id}.yaml`)
  }, [crds, openFile, placing])

  // "One per item of": the kernel's plan, one batch, and the refusal said under the field.
  const rangeNode = (id: string, forEach: string | null): string | null => {
    const plan = setForEach(filesRef.current, id, forEach)
    if (!plan.ok) {
      return plan.reason
    }
    const outcome = emitFilesBatch({ edit: plan.edit, expect: plan.expect, kind: 'blueprint' })
    return outcome?.ok ? null : `Nothing was changed — ${outcome ? outcome.error : 'no provider answered'}`
  }

  const openFormEditor = (addType: FormFieldType | null) =>
    setFormEditor((last) => ({ addType, nonce: last.nonce + 1, open: true }))

  // Publish — the same runDraftPublish the agent's verb takes, asked for by a person. It PROPOSES
  // the write: the destination form and the blast-radius confirm still run, and a person answers.
  const publish = () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    publishId.current = id
    setPublished(null)
    setPublishing(true)
    emitPublishRequest({ id, verb: 'publishBlueprint' })
  }

  const shown = useMemo(() => heldBlueprintPayload(files, requests.lastRender), [files, requests.lastRender])

  if (mode !== 'blueprint' || !shown) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>{EYEBROW}</span>
          <h1 className={styles.pageTitle}>Blueprint composer</h1>
          <p className={styles.subtitle}>
            Author a chart and the file that describes it — its resources, what depends on what, and the states it
            moves through — then publish the whole set as one change request.
          </p>
        </header>
        <BlueprintEmptyState onDiscard={emitDraftClose} onStart={() => setStartOpen(true)} parkedPage={mode === 'page'} />
        <StartChartModal
          onCancel={() => setStartOpen(false)}
          onStart={requests.start}
          open={startOpen && mode === 'empty'}
          owner={owner}
          pending={requests.pending === 'start'}
          refusal={requests.startRefusal}
        />
      </div>
    )
  }

  const name = chartYamlName(files[CHART_YAML_PATH])
  const meta = [chartYamlVersion(files[CHART_YAML_PATH]), name ? compositionKind(name) : null].filter(Boolean).join(' · ')
  const rendering = requests.pending !== null
  const blocker = publishBlocker(held, rendering)
  // A "rendered" answer says Publish is on UNTIL THE CHART CHANGES — so once the held files differ
  // from the ones it rendered it is no longer true, and beside the disabled Publish and the
  // "Preview needed" pill it contradicted them. Measured like the Source caption (the files the
  // render was of), not by the gate broadcast, which can arrive after the answer it arms.
  const renderStale = !!requests.lastRender?.files && !sameFiles(requests.lastRender.files, files)
  const outcome = requests.outcome && !(requests.outcome.outcome === 'rendered' && renderStale) ? renderOutcomeCopy(requests.outcome) : null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <span className={styles.eyebrow}>{EYEBROW}</span>
            <h1 className={styles.title}>
              {name ?? draftDisplayName(files)}
              {meta ? <>{' '}<span className={styles.titleMeta}>{meta}</span></> : null}
            </h1>
          </div>
          <span className={styles.spacer} />
          {/* A count, with no cap to measure it against (frontend#367). */}
          <span className={styles.countPill} title='Files held in the draft'>{counted(Object.keys(files).length, 'file')}</span>
          {/* The EXCEPTION only (status indicators are exception-only): nothing marks a chart whose
              preview stands. `previewed` absent means unknown — no claim either way. */}
          {held.previewed === false ? <StatusPill color='warning' label='Preview needed' /> : null}
          <Space wrap>
            <Button loading={rendering} onClick={requests.preview}>{rendering ? 'Previewing…' : 'Preview'}</Button>
            <Button disabled={!undoDepth} onClick={() => emitDraftUndo()}>Undo</Button>
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
            {/* Confirmed rather than immediate: the draft is not recoverable, and nothing else in
                view says so. A REAL discard — the provider drops the held draft, not only this view. */}
            <Popconfirm
              cancelText='Keep editing'
              okText='Discard'
              onConfirm={emitDraftClose}
              title='Discard this chart draft? Its unpublished files are deleted.'
            >
              <Button>Close draft</Button>
            </Popconfirm>
          </Space>
          {blocker ? <span className={styles.srOnly} id={blockerId}>{blocker}</span> : null}
        </div>
        <DraftProblemsAlert problems={held.problems ?? []} />
        {outcome ? (
          <Alert
            closable
            description={outcome.lines?.length ? <ul>{outcome.lines.map((line) => <li key={line}>{line}</li>)}</ul> : undefined}
            onClose={requests.dismiss}
            showIcon
            title={outcome.title}
            type={outcome.type}
          />
        ) : null}
        {published ? (
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
        ) : null}
      </header>

      <div className={styles.body}>
        <ArchitecturePalette
          chart={name}
          onDismissRefusal={() => setPlaceRefusal(null)}
          onFormField={openFormEditor}
          onPlace={(row) => { void place(row) }}
          placing={placing}
          refusal={placeRefusal}
          resources={architecture?.resources ?? NO_RESOURCES}
        />
        <div className={styles.centre}>
          <ArchitectureCanvas
            model={model}
            onAddDescriptor={addDescriptor}
            onLevel={setLevel}
            onOpenFile={openFile}
            onSelect={select}
            selected={selectedNode ? selected : null}
            steps={steps}
            view={view}
          />
          {/* Chart files | Source — no Rendered tab: a chart preview has no live endpoint. Chart
              files is editable in place; each accepted edit rides the file-edit bus into the held
              draft, and turns Publish off until the next Preview. */}
          <section aria-label='Chart files and Source' className={`${styles.pane} ${styles.filesPane}`}>
            <div className={styles.section}>
              <PreviewContent
                caption={renderCaption(files, requests.lastRender)}
                editVerdicts={editVerdicts}
                focusNonce={focus?.nonce}
                focusPath={focus?.path ?? null}
                hideDraftProblems
                liveFiles={files}
                onVerdicts={setEditVerdicts}
                payload={shown}
              />
            </div>
          </section>
        </div>
        <div className={styles.side}>
          <StatePanel model={model} view={view} />
          <NodeInspector
            fileCount={Object.keys(files).length}
            hasFile={hasFile}
            levels={view.status === 'ok' ? view.derived.levels : null}
            node={selectedNode}
            onClear={() => { setSelected(null); setPlaced(null) }}
            onOpenFile={openFile}
            onOpenFormEditor={() => openFormEditor(null)}
            onSetForEach={rangeNode}
            // Transient: said about the node just placed, until Preview renders the chart again.
            placedNote={placed && selectedNode?.id === placed.id && held.previewed !== true ? placed : null}
            schemaText={files[VALUES_SCHEMA_PATH]}
            templateText={selectedNode && hasFile(selectedNode.template) ? files[selectedNode.template] : undefined}
          />
        </div>
      </div>
      <FormEditorDrawer
        addNonce={formEditor.nonce}
        addType={formEditor.addType}
        onClose={() => setFormEditor((last) => ({ ...last, open: false }))}
        open={formEditor.open}
        schemaText={files[VALUES_SCHEMA_PATH]}
      />
    </div>
  )
}

export default BlueprintComposer
