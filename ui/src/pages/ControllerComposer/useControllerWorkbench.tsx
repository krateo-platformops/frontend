/**
 * The Controller Builder's WORKBENCH (T8, frontend#412) — the editor state its palette (`openapi`),
 * canvas (`restdef-graph`) and inspector (`restdef-mapping`) share about a held controller, for
 * ComposerHost to mount. The host owns the page, its header and the files pane; this owns the controller.
 *
 * WHAT A CONTROLLER IS HERE. A chart (controllerChart.ts): the OpenAPI document in a ConfigMap, and one
 * RestDefinition per Kind. Everything the composer shows is READ from those files on every broadcast
 * — the palette from the document, the canvas and the inspector from the RestDefinitions — so a hand
 * edit in Chart files, an Undo, or a resumed draft is drawn exactly as held. Nothing is kept here that
 * the files do not say, except which Kind is selected and why the last gesture did not land.
 *
 * EVERY WRITE IS ONE FILES BATCH of the controller draft kind, pinned to the bytes it was planned from,
 * and — like every write — it turns Publish off until Preview renders the controller again.
 *
 * PREVIEW. The provider answers it: until the controller render ships (T9, frontend#413) that answer
 * is "not available yet", said plainly — nothing is faked, nothing is armed, Publish stays off.
 */
import { Alert } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { HostDraft, Workbench } from '../../builders/host/hostTypes'
import { draftDisplayName } from '../../components/Autopilot/blueprintDraft'
import type { AutopilotPreviewPayload } from '../../components/Autopilot/previewBus'
import { emitDraftClose, onDraftClose } from '../../components/Autopilot/previewDraftClose'
import { emitFilesBatch } from '../../components/Autopilot/previewFilesBatch'
import { renderOutcomeCopy } from '../BlueprintComposer/renderOutcome'
import { useChartRequests } from '../BlueprintComposer/useChartRequests'

import {
  planCompareScope,
  planPlaceGroup,
  planRemoveKind,
  planSetVerb,
  planToggleConfigurationField,
  planToggleField,
  readController,
  type CompareScope,
  type ControllerModel,
  type ControllerPlan,
} from './controllerChart'
import ControllerEmptyState from './ControllerEmptyState'
import { classifyOperation, type RestAction } from './operationMapping'
import { operationsInGroup } from './paletteModel'
import StartControllerModal from './StartControllerModal'

export const CONTROLLER_FILES_CAPTION = 'Chart files is the tree the change request commits — each Kind is its RestDefinition, and the OpenAPI document rides in its ConfigMap. Edit a file in place; the canvas and the inspector read it back.'

export const RENDERED_PLACEHOLDER = 'The create form of each generated Kind appears here once Preview can render the controller (frontend#413). Nothing has been rendered.'

/** Why a gesture did not land, and where it is said: under a palette group, or on the canvas/inspector. */
export interface ControllerRefusal {
  where: 'palette' | 'canvas' | 'inspector'
  key: string
  reason: string
}

const verbLine = (model: ControllerModel): string[] => model.kinds.map((entry) => {
  const resource = (entry.restDefinition.spec as { resource?: { verbsDescription?: { action?: string; method?: string; path?: string }[] } } | undefined)?.resource
  const verbs = (resource?.verbsDescription ?? []).map((verb) => `${verb.action} ${verb.method} ${verb.path}`)
  return `${entry.kind} → ${verbs.length ? verbs.join(' · ') : 'no verbs yet'}`
})

export const useControllerWorkbench = (host: HostDraft) => {
  const { builder, files, kind, mode, openFile } = host
  const [startOpen, setStartOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<ControllerRefusal | null>(null)
  const requests = useChartRequests()
  const { reset } = requests

  const model = useMemo(() => readController(files), [files])
  const selectedKind = model.kinds.find((entry) => entry.path === selected) ?? null

  const forgetShown = useCallback(() => {
    reset()
    setSelected(null)
    setRefusal(null)
  }, [reset])
  useEffect(() => onDraftClose(forgetShown), [forgetShown])

  // The Start modal belongs to the empty page: once anything is held it closes, and stays closed.
  useEffect(() => setStartOpen((open) => open && mode === 'empty'), [mode])

  /** One batch for a plan; the refusal said where the gesture was made. Returns whether it landed. */
  const write = useCallback((plan: ControllerPlan, where: ControllerRefusal['where'], key: string): boolean => {
    if (!plan.ok) {
      setRefusal({ key, reason: plan.reason, where })
      return false
    }
    const outcome = emitFilesBatch({
      kind: 'controller',
      ...(plan.add ? { add: plan.add } : {}),
      ...(plan.edit ? { edit: plan.edit } : {}),
      ...(plan.remove ? { remove: plan.remove } : {}),
      ...(plan.expect ? { expect: plan.expect } : {}),
    })
    if (!outcome?.ok) {
      setRefusal({ key, reason: `Nothing was changed — ${outcome ? outcome.error : 'no provider answered, so the draft did not change'}`, where })
      return false
    }
    setRefusal(null)
    return true
  }, [])

  const place = useCallback((group: string, where: 'palette' | 'canvas' = 'palette') => {
    const plan = planPlaceGroup(files, group)
    if (write(plan, where, group) && plan.ok) {
      setSelected(plan.path)
      openFile(plan.path)
    }
  }, [files, openFile, write])

  const select = useCallback((path: string | null) => {
    setSelected(path)
    setRefusal(null)
    if (path) { openFile(path) }
  }, [openFile])

  /** One operation dropped on a Kind: the verb its path shape says, set to it. */
  const dropOperation = useCallback((path: string, operationKey: string) => {
    const target = model.kinds.find((entry) => entry.path === path)
    const operation = model.spec?.oas.operations.find((entry) => entry.key === operationKey)
    if (!target || !operation || !model.spec) {
      setRefusal({ key: path, reason: 'That operation is not in the held document any more.', where: 'canvas' })
      return
    }
    const items = new Set(operationsInGroup(model.spec.oas.operations, operation.group).map((entry) => entry.path).filter((entry) => /\}$/.test(entry)))
    const classified = classifyOperation(operation, items)
    if (!classified.action) {
      setRefusal({ key: path, reason: `${operation.key} is not a verb of ${target.kind}: ${classified.reason}.`, where: 'canvas' })
      return
    }
    if (write(planSetVerb(files, path, classified.action, { method: operation.method, path: operation.path }), 'canvas', path)) {
      setSelected(path)
    }
  }, [files, model, write])

  const inspectorKey = selectedKind?.path ?? ''
  const edit = (plan: ControllerPlan) => { write(plan, 'inspector', inspectorKey) }

  const name = model.name ?? draftDisplayName(files)
  const shown = useMemo((): AutopilotPreviewPayload | null => (mode === 'own' && Object.keys(files).length ? {
    builder: 'controller',
    caption: CONTROLLER_FILES_CAPTION,
    files: Object.entries(files).map(([path, content]) => ({ content, path })),
    filesLabel: 'Chart files',
    objects: [],
    publishTarget: { base: 'main', note: 'merged, CI publishes it as a versioned OCI Helm chart', repo: name },
    renderedPlaceholder: RENDERED_PLACEHOLDER,
    summary: verbLine(model),
    title: `Controller — ${name}`,
  } : null), [files, mode, model, name])

  const outcome = requests.outcome ? renderOutcomeCopy(requests.outcome) : null
  const kinds = model.kinds.map((entry) => entry.kind)
  const meta = [model.version, kinds.length ? kinds.join(', ') : null, model.group || null].filter(Boolean).join(' · ')

  const slots = {
    canvas: {
      model,
      onDismissRefusal: () => setRefusal(null),
      onDropGroup: (group: string) => place(group, 'canvas'),
      onDropOperation: dropOperation,
      onSelect: select,
      refusal: refusal?.where === 'canvas' ? refusal : null,
      selected: selectedKind ? selected : null,
    },
    inspector: {
      kind: selectedKind,
      model,
      onClear: () => select(null),
      onCompareScope: (scope: CompareScope | null) => edit(planCompareScope(files, inspectorKey, scope)),
      onDismissRefusal: () => setRefusal(null),
      onOpenFile: openFile,
      onRemove: () => {
        if (write(planRemoveKind(files, inspectorKey), 'inspector', inspectorKey)) { setSelected(null) }
      },
      onSetVerb: (action: RestAction, choice: { method: string; path: string } | null) => edit(planSetVerb(files, inspectorKey, action, choice)),
      onToggleConfigurationField: (parameter: { name: string; in: string; actions: string[] }) => edit(planToggleConfigurationField(files, inspectorKey, parameter)),
      onToggleField: (list: 'identifiers' | 'additionalStatusFields', field: string) => edit(planToggleField(files, inspectorKey, list, field)),
      refusal: refusal?.where === 'inspector' ? refusal : null,
    },
    palette: {
      model,
      onDismissRefusal: () => setRefusal(null),
      onPlace: (group: string) => place(group),
      refusal: refusal?.where === 'palette' ? refusal : null,
    },
  }

  const workbench: Workbench<typeof slots> = {
    empty: (
      <>
        <ControllerEmptyState builder={builder.spec.label} held={host.held.kind ?? null} onDiscard={emitDraftClose} onStart={() => setStartOpen(true)} parked={mode === 'parked'} />
        <StartControllerModal
          fields={host.spec.start.fields}
          onCancel={() => setStartOpen(false)}
          onStart={(started) => requests.start(started, kind)}
          open={startOpen && mode === 'empty'}
          pending={requests.pending === 'start'}
          refusal={requests.startRefusal}
        />
      </>
    ),
    files: { caption: CONTROLLER_FILES_CAPTION },
    kind,
    notices: outcome ? (
      <Alert
        closable
        description={outcome.lines?.length ? <ul>{outcome.lines.map((line) => <li key={line}>{line}</li>)}</ul> : undefined}
        onClose={requests.dismiss}
        showIcon
        title={outcome.title}
        type={outcome.type === 'warning' && requests.outcome?.outcome === 'unavailable' ? 'info' : outcome.type}
      />
    ) : null,
    onResumed: forgetShown,
    preview: { pending: requests.pending !== null, run: requests.preview },
    shown,
    slots,
    title: { meta, name },
  }
  return workbench
}

export type ControllerSlots = ReturnType<typeof useControllerWorkbench>['slots']
