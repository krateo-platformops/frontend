/**
 * The workbenches the composer host mounts, by a Builder's `spec.draftKind` (T4, frontend#410) — see
 * hostTypes.ts for what a workbench is. Deny by default, like pluginRegistry: only an own key
 * resolves, and a draft kind with none (the controller's, until T8) is a sentence, never a blank composer.
 */
import type { DraftKind } from '../../components/Autopilot/blueprintDraftStore'
import { useBlueprintWorkbench } from '../../pages/BlueprintComposer/useBlueprintWorkbench'
import { usePageWorkbench } from '../../pages/PageComposer/usePageWorkbench'

import type { WorkbenchPlugin } from './hostTypes'

const WORKBENCHES = {
  blueprint: {
    allowAdopt: false,
    description: 'a chart: its resources as a graph, their dependency gates, the states it steps through',
    summary: 'Author a chart and the file that describes it — its resources, what depends on what, and the states it moves through — then publish the whole set as one change request.',
    useWorkbench: useBlueprintWorkbench,
  },
  page: {
    // `?adopt=` takes over a legacy page set (Unowned drafts); charts have no legacy form.
    allowAdopt: true,
    description: 'a page set: widgets dragged into containers, the RESTActions behind them, the live render',
    summary: 'Author a page and everything it needs — widgets, layout and the RESTActions behind them — then publish the whole set as one change request.',
    useWorkbench: usePageWorkbench,
  },
} satisfies Partial<Record<DraftKind, WorkbenchPlugin>>

/** The workbench for a draft kind, or a sentence saying this frontend has none. */
export const resolveWorkbench = (draftKind: string): { ok: true; kind: DraftKind; plugin: WorkbenchPlugin } | { ok: false; refusal: string } =>
  (Object.prototype.hasOwnProperty.call(WORKBENCHES, draftKind)
    ? { kind: draftKind as DraftKind, ok: true, plugin: WORKBENCHES[draftKind as keyof typeof WORKBENCHES] }
    : { ok: false, refusal: `This frontend has no workbench for the draft kind "${draftKind}", so the composer cannot be shown. It ships: ${Object.keys(WORKBENCHES).sort().join(', ')}.` })
