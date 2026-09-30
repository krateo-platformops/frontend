/**
 * The Blueprint Builder's WORKBENCH — the editor state its palette (`kinds`), canvas
 * (`architecture-graph`) and inspector (`node`) share about a held chart, for ComposerHost to mount
 * (T4, frontend#410). The host owns the page, its header and the files pane; this owns the chart.
 *
 * WHAT A CHART IS HERE. A chart and the file that describes it: its resources, what depends on what,
 * and the states it moves through — drawn as a graph, stepped as a machine, and published as one
 * change request. It is the same draft Autopilot authors, started and previewed by a person.
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
 * chart again. A placement belongs to the draft it was made on: one whose CRD read is still on the
 * wire when that draft is discarded or replaced is dropped when the read lands, never planned into
 * the next chart. The form editor (screen 10) writes values.schema.json on the file-edit bus.
 *
 * EDGES (screens 6 and 7): a drag from one card onto another, or the inspector's "Add dependency",
 * makes a PENDING edge the edge inspector asks about — wait for readiness, and what "ready" means —
 * and Accept writes it as one batch: the dependent's `dependsOn` in the descriptor, the target's
 * `readyWhen`, and the generated `krateo:gate` in every template that must now wait (planEdge,
 * useEdgeEditing). Chart files then opens the dependent's template with its gate lit. The inspector's
 * Depends-on rows, a node's Ready when and Remove from chart go through the same kernel. Hand-written
 * gates are left alone and listed on the Source tab.
 *
 * IT NEVER READS A PAGE DRAFT AS A CHART (a page set carries Chart.yaml too): the host hands it the
 * files only when the held draft is this Builder's kind.
 */
import { Alert } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { heldModeOf } from '../../builders/host/heldMode'
import type { HostDraft, Workbench } from '../../builders/host/hostTypes'
import { CHART_YAML_PATH, VALUES_SCHEMA_PATH, chartYamlName, chartYamlVersion, draftDisplayName } from '../../components/Autopilot/blueprintDraft'
import { resolveBuilderTarget } from '../../components/Autopilot/builderTargets'
import { extractCrdSpecFields, type CrdSpecExtract } from '../../components/Autopilot/describeResource'
import { AUTOPILOT_PREVIEW_EVENT, isBuilderPayload, type AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { onDraftChanged } from '../../components/Autopilot/previewDraftChanged'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { emitFileAdd } from '../../components/Autopilot/previewFileAdd'
import { emitFilesBatch } from '../../components/Autopilot/previewFilesBatch'
import type { FileHighlight } from '../../components/Autopilot/previewSurface'

import {
  ARCHITECTURE_API_VERSION,
  ARCHITECTURE_KIND,
  ARCHITECTURE_TEMPLATE_PATH,
  serializeArchitecture,
  wrapAsConfigMapTemplate,
  type ResourceNode,
} from './architecture'
import type { PlaceRefusal } from './ArchitecturePalette'
import { architectureView } from './architectureView'
import BlueprintEmptyState from './BlueprintEmptyState'
import type { PaletteRead } from './blueprintPalette'
import FormEditorDrawer from './FormEditorDrawer'
import { GateDriftAction } from './GateDriftAction'
import { gateLineRanges, unmanagedGateNotes } from './gateGen'
import { heldBlueprintPayload, lastRenderOf, renderCaption, sameFiles } from './heldBlueprintPayload'
import type { PaletteRow } from './paletteModel'
import { planSetForEach, legalEdgeTargets } from './planEdge'
import { placementCrd, planPlace } from './planPlace'
import { renderOutcomeCopy } from './renderOutcome'
import type { FormFieldType } from './schemaEdit'
import { compositionKind, VALUES_YAML_PATH } from './startChart'
import StartChartModal from './StartChartModal'
import { stepperModel, type StepperModel } from './stepperModel'
import { useChartRequests } from './useChartRequests'
import { useConditions } from './useConditions'
import { useCrdSchema } from './useCrdSchema'
import { useEdgeEditing } from './useEdgeEditing'
import { useStatusFields } from './useStatusFields'

const NOTHING: Record<string, string> = {}
const NO_RESOURCES: ResourceNode[] = []

export const CHART_CHANGED = 'The chart changed while its CRD was read — nothing was placed.'

export const GATE_CAPTION = `Generated from ${ARCHITECTURE_TEMPLATE_PATH} — edit the descriptor, not this block.`

/** The chart a broadcast holds, by its Chart.yaml name ('' when it has none) — or null for no chart. */
const chartOf = (files: Readonly<Record<string, string>>): string | null =>
  (files === NOTHING ? null : chartYamlName(files[CHART_YAML_PATH]) ?? '')

export const useBlueprintWorkbench = (host: HostDraft) => {
  const { api, builder, files, held, kind, mode, openFile, sideRef: side } = host
  // Config supplies the owner the Start modal shows a location under, and the snowplow URL the
  // palette's CRD reads go to.
  const { owner } = resolveBuilderTarget((api as Record<string, string | undefined> | undefined)?.[host.spec.publish.targetKey])
  const crds = useCrdSchema(api?.SNOWPLOW_API_BASE_URL)
  const [startOpen, setStartOpen] = useState(false)
  // Done on "What just happened" unmounts the button it was pressed on: focus goes to the inspector
  // that takes its place, not to the page.
  const [inspectorFocus, setInspectorFocus] = useState(false)
  const [level, setLevel] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const requests = useChartRequests()
  const { adopt, reset } = requests
  // Placing: the row whose CRD is being read, why the last one did not land (said under its row),
  // and what the node just placed says.
  const [placing, setPlacing] = useState<PaletteRow | null>(null)
  const [placeRefusal, setPlaceRefusal] = useState<PlaceRefusal | null>(null)
  const [placed, setPlaced] = useState<{ id: string; specNote?: string } | null>(null)
  // What a placement plans from once its CRD read lands: the files as the LAST BROADCAST held them —
  // kept here by the broadcast handler, not read off a render — not as they were when the row was
  // pressed. The batch's `expect` refuses a plan made from stale bytes WITHIN one draft; it cannot
  // tell one draft from another that holds the same descriptor (every freshly started chart does).
  const filesRef = useRef<Readonly<Record<string, string>>>(NOTHING)
  // So a placement also remembers WHICH draft it was made on, and is dropped when its read lands if
  // that draft was discarded (a count of discards), replaced by another chart (the chart held, as of
  // the last broadcast), or the page has gone.
  const discards = useRef(0)
  const heldChart = useRef<string | null>(null)
  const mounted = useRef(true)
  const [formEditor, setFormEditor] = useState<{ open: boolean; addType: FormFieldType | null; nonce: number }>({ addType: null, nonce: 0, open: false })
  // What the palette may place — also where the readiness picker finds a node's CRD — and the
  // template an accepted edge just gated, lit in Chart files.
  const [paletteRead, setPaletteRead] = useState<PaletteRead | null>(null)
  const [gated, setGated] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The files as the last broadcast held them, kept synchronously for a placement in flight.
  useEffect(() => onDraftChanged((detail) => {
    // A page draft's files are never read here, not even to count them.
    filesRef.current = heldModeOf(detail, kind) === 'own' ? detail.files : NOTHING
    heldChart.current = chartOf(filesRef.current)
  }), [kind])

  // The agent's previewBlueprint of the HELD chart: the drawer defers it here while this page holds
  // the claim, so this page is the only place it can be seen.
  const builderName = builder.metadata.name
  useEffect(() => {
    const onPreview = (event: Event): void => {
      const payload = (event as CustomEvent<AutopilotPreviewPayload>).detail
      if (payload && isBuilderPayload(payload, builderName)) {
        adopt(lastRenderOf(payload))
      }
    }
    window.addEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(AUTOPILOT_PREVIEW_EVENT, onPreview)
  }, [adopt, builderName])

  // A discard (this page's, or anyone's) or a `?resume=` that replaced the draft: nothing shown
  // describes what is held any more; a placement whose CRD read is on the wire is dropped (`discards`).
  const forgetShown = useCallback(() => {
    discards.current += 1
    reset()
    setSelected(null)
    setLevel(0)
    setPlaced(null)
    setPlacing(null); setPlaceRefusal(null)
    setFormEditor((last) => ({ ...last, open: false }))
  }, [reset])
  useEffect(() => onDraftClose(forgetShown), [forgetShown])

  // The Start modal belongs to the empty page: once anything is held — the start landed, or a draft
  // arrived from elsewhere — it closes, and does not come back when that draft is discarded.
  useEffect(() => setStartOpen((open) => open && mode === 'empty'), [mode])

  // Keyed on the file's TEXT (a string), not on `files` — see architectureView's header.
  const architectureText = files[ARCHITECTURE_TEMPLATE_PATH]
  const view = useMemo(() => architectureView(architectureText), [architectureText])
  // Conditions (screens 8b/8c): the machine the values select — the full view for the canvas's
  // layout, the variant for the stepper and the state panel.
  const machine = useConditions(view, files[VALUES_YAML_PATH])
  const stepView = machine.view
  const steps = useMemo((): StepperModel[] => {
    if (stepView.status !== 'ok') {
      return []
    }
    const total = Math.max(1, stepView.derived.states.length)
    return Array.from({ length: total }, (_, index) => stepperModel(stepView.architecture, stepView.derived, index))
  }, [stepView])
  const model = steps.length ? steps[Math.min(level, steps.length - 1)] : null
  const architecture = view.status === 'ok' || view.status === 'cycle' ? view.architecture : null
  const selectedNode = architecture?.resources.find((node) => node.id === selected) ?? null

  // Edges: the pending one, the drag, and what an accepted one did (screens 6 and 7).
  const edges = useEdgeEditing({
    architecture,
    files,
    filesRef,
    onAccepted: (edge, template) => {
      setSelected(edge.from)
      setGated(template)
      openFile(template)
    },
  })
  useEffect(() => {
    if (!inspectorFocus || edges.accepted) { return }
    side.current?.querySelector<HTMLElement>('section[aria-label="Inspector"]')?.focus()
    setInspectorFocus(false)
  }, [edges.accepted, inspectorFocus, side])
  const pendingTarget = architecture?.resources.find((node) => node.id === edges.pending?.to) ?? null
  const pendingStatus = useStatusFields(pendingTarget, paletteRead, crds.read)
  const selectedStatus = useStatusFields(selectedNode, paletteRead, crds.read)
  const targets = useMemo(() => (architecture && selected ? legalEdgeTargets(architecture, selected) : null), [architecture, selected])
  const sourceNotes = useMemo(() => unmanagedGateNotes(files), [files])
  const gatedText = edges.accepted && gated ? files[gated] : undefined
  const highlight = useMemo((): FileHighlight | null => (gated && gatedText !== undefined
    ? { caption: GATE_CAPTION, path: gated, ranges: gateLineRanges(gatedText) }
    : null), [gated, gatedText])

  // Own keys only: a template path named `constructor` is not a file this chart holds.
  const hasFile = useCallback((path: string) => Object.prototype.hasOwnProperty.call(files, path), [files])

  const { cancel: cancelEdge, dismissAccepted, dismissRefusal, reset: resetEdges } = edges
  // A discard ends every edge gesture, and retires what the last accept did.
  useEffect(() => onDraftClose(() => {
    resetEdges()
    setGated(null)
  }), [resetEdges])

  // A node, from the canvas: the inspector shows it, and Chart files opens its template — when the
  // chart has one (the inspector says so when it does not). Any edge gesture is over.
  const select = useCallback((id: string) => {
    setSelected(id)
    cancelEdge()
    dismissAccepted()
    dismissRefusal()
    setPlaced((last) => (last?.id === id ? last : null))
    const node = architecture?.resources.find((resource) => resource.id === id)
    if (node && hasFile(node.template)) { openFile(node.template) }
  }, [architecture, cancelEdge, dismissAccepted, dismissRefusal, hasFile, openFile])

  const addDescriptor = () => {
    const chart = chartYamlName(files[CHART_YAML_PATH]) ?? draftDisplayName(files)
    const descriptor = serializeArchitecture({ apiVersion: ARCHITECTURE_API_VERSION, chart, kind: ARCHITECTURE_KIND, resources: [] })
    emitFileAdd({ content: wrapAsConfigMapTemplate(descriptor, chart), path: ARCHITECTURE_TEMPLATE_PATH })
    openFile(ARCHITECTURE_TEMPLATE_PATH)
  }

  // PLACE a palette row: the kernel's preflight (no descriptor, the chart nested into itself) before
  // any read, the CRD read for a kind that has one, then one batch. The node is selected and its
  // template revealed. One CRD read at a time — a second is refused in words, under its row; a native
  // kind reads nothing and places at once, since the placement in flight plans from the files as
  // they are when its read lands.
  const place = useCallback(async (row: PaletteRow) => {
    const crd = placementCrd(row.pick)
    if (crd && placing) {
      setPlaceRefusal({ key: row.key, reason: `${placing.primary} is still being placed — its CRD is being read.` })
      return
    }
    setPlaceRefusal(null)
    const preflight = planPlace(filesRef.current, row.pick, null)
    if (!preflight.ok) {
      setPlaceRefusal({ key: row.key, reason: preflight.reason })
      return
    }
    let spec: CrdSpecExtract | null = null
    let specNote: string | undefined
    if (crd) {
      const discarded = discards.current
      const chart = heldChart.current
      setPlacing(row)
      const read = await crds.read(crd.name)
      // Discarded, or the page has gone: nothing is placed and nothing is said — the discard (or the
      // leaving) is what the person did, and the next chart must not open on a refusal about this one.
      if (!mounted.current || discards.current !== discarded) { return }
      setPlacing(null)
      // Another chart is held now (the agent's, a rename in Chart.yaml): said under the row — unless
      // no chart is, and there is no palette to say it in.
      if (heldChart.current !== chart) {
        if (heldChart.current !== null) { setPlaceRefusal({ key: row.key, reason: CHART_CHANGED }) }
        return
      }
      spec = 'crd' in read ? extractCrdSpecFields(read.crd, crd.version) : null
      // Two different things, never one sentence: a read that failed, and a read that answered with
      // no spec schema at the pick's version.
      if ('error' in read) {
        specNote = `Its CRD could not be read (${read.error})`
      } else if (!spec) {
        specNote = `Its CRD declares no spec schema at ${crd.version}`
      }
    }
    const plan = planPlace(filesRef.current, row.pick, spec, specNote)
    if (!plan.ok) {
      setPlaceRefusal({ key: row.key, reason: plan.reason })
      return
    }
    const outcome = emitFilesBatch({ add: plan.add, edit: plan.edit, expect: plan.expect, kind: 'blueprint' })
    if (!outcome?.ok) {
      setPlaceRefusal({ key: row.key, reason: `Nothing was placed — ${outcome ? outcome.error : 'no provider answered, so the draft did not change'}` })
      return
    }
    setSelected(plan.id)
    setPlaced({ id: plan.id, specNote })
    openFile(`templates/${plan.id}.yaml`)
  }, [crds, openFile, placing])

  // "One per item of": the kernel's plan — its gate, and every gate on it, following (planSetForEach) —
  // one batch, and the refusal said under the field.
  const rangeNode = (id: string, forEach: string | null): string | null => {
    const plan = planSetForEach(filesRef.current, id, forEach)
    if (!plan.ok) {
      return plan.reason
    }
    const outcome = emitFilesBatch({ edit: plan.edit, expect: plan.expect, kind: 'blueprint' })
    return outcome?.ok ? null : `Nothing was changed — ${outcome ? outcome.error : 'no provider answered'}`
  }

  const openFormEditor = (addType: FormFieldType | null) =>
    setFormEditor((last) => ({ addType, nonce: last.nonce + 1, open: true }))

  const shown = useMemo(() => (mode === 'own' ? heldBlueprintPayload(files, requests.lastRender) : null), [files, mode, requests.lastRender])

  // A "rendered" answer says Publish is on UNTIL THE CHART CHANGES — so once the held files move away
  // from the ones it rendered, it is closed for good. Every write to a chart disarms it, an Undo
  // included, so held bytes that come BACK to the rendered ones (place, then Undo) are not armed
  // again, and the answer must not come back with them beside a disabled Publish. Measured like the
  // Source caption (the files the render was of), never by the gate broadcast, which can arrive after
  // the answer it arms.
  const renderedAway = requests.outcome?.outcome === 'rendered' && !!requests.lastRender?.files && !sameFiles(requests.lastRender.files, files)
  const { dismiss } = requests
  useEffect(() => {
    if (renderedAway) { dismiss() }
  }, [dismiss, renderedAway])

  const name = chartYamlName(files[CHART_YAML_PATH])
  const meta = [chartYamlVersion(files[CHART_YAML_PATH]), name ? compositionKind(name) : null].filter(Boolean).join(' · ')
  // …and not shown in the one frame before that effect dismisses it.
  const outcome = requests.outcome && !renderedAway ? renderOutcomeCopy(requests.outcome) : null

  const slots = {
    canvas: {
      absent: machine.absent,
      conditions: machine,
      edges,
      model,
      onAddDescriptor: addDescriptor,
      onLevel: setLevel,
      onOpenFile: openFile,
      onSelect: select,
      selected: selectedNode ? selected : null,
      steps,
      view,
    },
    inspector: {
      architecture,
      edges,
      files,
      hasFile,
      machine,
      model,
      onClear: () => { setSelected(null); setPlaced(null) },
      onDone: () => { edges.dismissAccepted(); setInspectorFocus(true) },
      onOpenFile: openFile,
      onOpenFormEditor: () => openFormEditor(null),
      onSelectedRemoved: () => setSelected(null),
      onSetForEach: rangeNode,
      pendingStatus,
      pendingTarget,
      // Transient: said about the node just placed, until Preview renders the chart again.
      placedNote: placed && selectedNode?.id === placed.id && held.previewed !== true ? placed : null,
      schemaText: files[VALUES_SCHEMA_PATH],
      selectedNode,
      selectedStatus,
      stepView,
      targets,
      view,
    },
    palette: {
      chart: name,
      dimmed: !!edges.pending || !!edges.drawing,
      onDismissRefusal: () => setPlaceRefusal(null),
      onFormField: openFormEditor,
      onPlace: (row: PaletteRow) => { void place(row) },
      onRead: setPaletteRead,
      placing: placing?.key ?? null,
      refusal: placeRefusal,
      resources: architecture?.resources ?? NO_RESOURCES,
    },
  }

  const workbench: Workbench<typeof slots> = {
    after: (
      <FormEditorDrawer
        addNonce={formEditor.nonce}
        addType={formEditor.addType}
        onClose={() => setFormEditor((last) => ({ ...last, open: false }))}
        open={formEditor.open}
        schemaText={files[VALUES_SCHEMA_PATH]}
      />
    ),
    empty: (
      <>
        <BlueprintEmptyState onDiscard={emitDraftClose} onStart={() => setStartOpen(true)} parkedPage={mode === 'parked'} />
        <StartChartModal
          onCancel={() => setStartOpen(false)}
          onStart={requests.start}
          open={startOpen && mode === 'empty'}
          owner={owner}
          pending={requests.pending === 'start'}
          refusal={requests.startRefusal}
        />
      </>
    ),
    files: { caption: renderCaption(files, requests.lastRender), highlight, sourceNotes },
    kind,
    notices: (
      <>
        <GateDriftAction files={files} />
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
      </>
    ),
    onResumed: forgetShown,
    preview: { pending: requests.pending !== null, run: requests.preview },
    shown,
    slots,
    title: { meta, name: name ?? draftDisplayName(files) },
  }
  return workbench
}

export type BlueprintSlots = ReturnType<typeof useBlueprintWorkbench>['slots']
