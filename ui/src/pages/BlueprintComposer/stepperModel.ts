/**
 * What the state stepper shows for one derived level. Pure.
 *
 * `deriveStates` answers "what renders by state N" (cumulative). The stepper needs three more
 * things, all derived from the same edges so the picture and the machine cannot disagree:
 *
 *   lit         — everything that renders in this state (cumulative, declaration order)
 *   frontier    — what ENTERS in this state: the resources whose level is exactly this one
 *   withheld    — what waits for a later state
 *   orthogonal  — `lifecycle` resources (shims): outside the sequence, in no state
 *   leavesWhen  — what has to become true to move on: every `ready: true` edge into the NEXT
 *                 level, with the dependency's `readyWhen`, or its class default when it has none
 *
 * Existence-only edges (no `ready`) are not in `leavesWhen`: a dependent that only needs its
 * dependency to exist renders on the reconcile after the dependency is applied — there is no
 * condition to wait on. The last state has no `leavesWhen`: the machine has nowhere to go.
 *
 * ZERO STATES. A chart with no sequenced resources — a fresh Start (`resources: []`), or only
 * shims — derives `states: []`, and "state 0 of 0" is not something a stepper can draw. The model
 * returns an explicit INITIAL shape instead: one state, `S1`, named `initial`, with nothing lit,
 * nothing entering, nothing withheld, no way out (`initial: true`, `total: 1`). The page renders it
 * as "S1 · initial" over an empty canvas. It is the same shape the first real resource then fills.
 */
import type { ChartArchitecture, DeriveResult, ResourceClass, ResourceNode } from './architecture'

/** The name the stepper shows for the one state a chart with no sequenced resources has. */
export const INITIAL_STATE_NAME = 'initial'

/** A readiness predicate the author did not have to write: what each class means by "ready". */
export const READINESS_DEFAULTS: Record<ResourceClass, string | null> = {
  // A composition projects its lifecycle through the two conditions every Krateo claim carries.
  composition: 'Ready=True and Synced=True',
  // A custom resource has no agreed readiness; the descriptor must say (the parser refuses a
  // `ready: true` edge onto one without it).
  custom: null,
  // kstatus: the kind's own convention (Deployment available, Job complete, Service endpoints …).
  native: 'kstatus Current',
}

/** Shown in place of a predicate when a custom resource has no readyWhen. */
export const MISSING_READINESS = 'no readyWhen — declare one'

export interface LeaveCondition {
  /** The dependency whose readiness is awaited. */
  from: string
  /** The dependent that renders in the next state once it holds. */
  to: string
  predicate: string
  /** readyWhen: declared on `from`; default: its class's; missing: a custom resource with none. */
  source: 'readyWhen' | 'default' | 'missing'
  /** Over a forEach dependency: every instance must satisfy it. */
  all?: true
  /** The edge applies only when this Values path is truthy. */
  when?: string
}

export interface StepperModel {
  /** The level shown — the one asked for, clamped into range. */
  level: number
  /** `S1`, `S2`, … — 1-based, as the mockup and the chart comments number them. */
  label: string
  /** A name from `states[]`, INITIAL_STATE_NAME for the zero-state, or null when unnamed. */
  name: string | null
  /** How many states the stepper has: at least 1. */
  total: number
  /** No sequenced resources at all — the zero-state described in the header. */
  initial: boolean
  lit: string[]
  frontier: string[]
  withheld: string[]
  orthogonal: string[]
  leavesWhen: LeaveCondition[]
}

export type DerivedMachine = Extract<DeriveResult, { ok: true }>

const readiness = (node: ResourceNode): Pick<LeaveCondition, 'predicate' | 'source'> => {
  if (node.readyWhen) {
    return { predicate: node.readyWhen, source: 'readyWhen' }
  }
  const fallback = READINESS_DEFAULTS[node.class]
  return fallback ? { predicate: fallback, source: 'default' } : { predicate: MISSING_READINESS, source: 'missing' }
}

const leaving = (arch: ChartArchitecture, levels: Record<string, number>, level: number): LeaveCondition[] => {
  const byId = new Map(arch.resources.map((node) => [node.id, node]))
  const out: LeaveCondition[] = []
  for (const node of arch.resources) {
    if (levels[node.id] !== level + 1) { continue }
    for (const dep of node.dependsOn ?? []) {
      const target = byId.get(dep.ref)
      if (!dep.ready || !target) { continue }
      const condition: LeaveCondition = { from: dep.ref, to: node.id, ...readiness(target) }
      if (dep.all) { condition.all = true }
      if (dep.when) { condition.when = dep.when }
      out.push(condition)
    }
  }
  return out
}

export const stepperModel = (arch: ChartArchitecture, derived: DerivedMachine, level: number): StepperModel => {
  const orthogonal = arch.resources.filter((node) => node.lifecycle).map((node) => node.id)
  const total = derived.states.length
  if (total === 0) {
    return {
      frontier: [], initial: true, label: 'S1', leavesWhen: [], level: 0, lit: [], name: INITIAL_STATE_NAME, orthogonal, total: 1, withheld: [],
    }
  }
  const at = Number.isFinite(level) ? Math.min(Math.max(Math.trunc(level), 0), total - 1) : 0
  const state = derived.states[at]
  return {
    frontier: state.renders.filter((id) => derived.levels[id] === at),
    initial: false,
    label: `S${at + 1}`,
    leavesWhen: at < total - 1 ? leaving(arch, derived.levels, at) : [],
    level: at,
    lit: state.renders,
    name: arch.states?.[at]?.name || null,
    orthogonal,
    total,
    withheld: state.withheld,
  }
}
