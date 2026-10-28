/**
 * The machine the Conditions strip selects (screens 8b/8c), for the composer: the conditions the
 * descriptor declares, their switch positions (values.yaml's until a person switches one), and the
 * variant view the stepper and the state panel read. The canvas keeps the FULL view for its layout —
 * a switch never re-lays the graph — and draws the variant's missing nodes as `absent`.
 */
import { useCallback, useMemo, useState } from 'react'

import { deriveStates } from './architecture'
import type { ArchitectureView } from './architectureView'
import { applyConditions, conditionsOf, defaultPositions, variantLabel, type Condition } from './conditions'
import type { StateVariant } from './StatePanel'

const NONE: readonly string[] = []

export interface ConditionedMachine {
  conditions: Condition[]
  positions: Record<string, boolean>
  /** The view the stepper and the state panel read: the variant's descriptor and derived states. */
  view: ArchitectureView
  absent: readonly string[]
  variant: StateVariant | null
  set: (path: string, on: boolean) => void
  reset: () => void
}

export const useConditions = (view: ArchitectureView, valuesYaml: string | undefined): ConditionedMachine => {
  const architecture = view.status === 'ok' ? view.architecture : null
  const conditions = useMemo(() => (architecture ? conditionsOf(architecture, valuesYaml) : []), [architecture, valuesYaml])
  const [switched, setSwitched] = useState<Record<string, boolean>>({})
  // Only the switches for conditions the descriptor still declares; a removed `when` forgets its switch.
  const positions = useMemo(() => {
    const out = defaultPositions(conditions)
    for (const condition of conditions) {
      if (Object.prototype.hasOwnProperty.call(switched, condition.path)) { out[condition.path] = switched[condition.path] }
    }
    return out
  }, [conditions, switched])
  const machine = useMemo((): Pick<ConditionedMachine, 'absent' | 'variant' | 'view'> => {
    if (view.status !== 'ok' || !conditions.length) {
      return { absent: NONE, variant: null, view }
    }
    const variant = applyConditions(view.architecture, positions)
    const derived = deriveStates(variant.architecture)
    // A variant is a subset of an acyclic graph, so it cannot hold a cycle; if it ever did, show the whole chart.
    if (!derived.ok) {
      return { absent: NONE, variant: null, view }
    }
    return {
      absent: variant.absent,
      variant: { absent: variant.absent, label: variantLabel(conditions, positions) },
      view: { ...view, architecture: variant.architecture, derived },
    }
  }, [conditions, positions, view])
  const set = useCallback((path: string, on: boolean) => setSwitched((last) => ({ ...last, [path]: on })), [])
  const reset = useCallback(() => setSwitched({}), [])
  return { ...machine, conditions, positions, reset, set }
}
