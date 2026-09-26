/**
 * What the composer's canvas can say about the held chart's architecture file. Pure.
 *
 * FIVE ANSWERS, EACH ITS OWN DESIGNED STATE — because the file is authored by hand, by an agent,
 * or not at all, and the canvas must never be the thing that crashes on it:
 *
 *   absent      there is no templates/architecture.yaml. Charts written before the composer, and
 *               charts an agent wrote without one, are like this. Everything else still works.
 *   unreadable  the file exists but carries no `data.architecture` block — someone rewrote the
 *               ConfigMap template, so there is no descriptor to read out of it.
 *   invalid     the descriptor is there and the kernel refuses it (bad YAML, a missing field, an
 *               edge onto nothing …). Named by path, as the lint names it.
 *   cycle       it parses, and its edges loop. The graph is still drawn — seeing the loop is how it
 *               gets fixed — but there are no states: a chart with a cycle never leaves its first.
 *   ok          a graph and the machine derived from it.
 *
 * Built from the file's TEXT, and the caller memoises on that string. A draft broadcast arrives
 * after every write and every gate change; memoising on the files object would rebuild the graph
 * — a full re-layout, the person's pan and zoom thrown away — each time Preview armed the chart.
 */
import {
  deriveStates,
  parseArchitecture,
  unwrapFromConfigMapTemplate,
  type ArchitectureProblem,
  type ChartArchitecture,
} from './architecture'
import { toArchitectureGraph, type ArchitectureGraph } from './architectureGraph'
import type { DerivedMachine, LeaveCondition, StepperModel } from './stepperModel'

export type ArchitectureView =
  | { status: 'absent' }
  | { status: 'unreadable' }
  | { status: 'invalid'; problems: ArchitectureProblem[] }
  | { status: 'cycle'; architecture: ChartArchitecture; cycle: string[]; graph: ArchitectureGraph }
  | { status: 'ok'; architecture: ChartArchitecture; derived: DerivedMachine; graph: ArchitectureGraph }

export const architectureView = (template: string | undefined): ArchitectureView => {
  if (template === undefined) {
    return { status: 'absent' }
  }
  const descriptor = unwrapFromConfigMapTemplate(template)
  if (descriptor === null) {
    return { status: 'unreadable' }
  }
  // The kernel reports rather than throws, but this runs during render: a throw here would take
  // the whole page down over a file the person is in the middle of typing.
  try {
    const parsed = parseArchitecture(descriptor)
    if (!parsed.ok) {
      return { problems: parsed.problems, status: 'invalid' }
    }
    const { architecture } = parsed
    const derived = deriveStates(architecture)
    const graph = toArchitectureGraph(architecture, derived)
    return derived.ok
      ? { architecture, derived, graph, status: 'ok' }
      : { architecture, cycle: derived.cycle, graph, status: 'cycle' }
  } catch (err) {
    return { problems: [{ message: err instanceof Error ? err.message : String(err), path: '' }], status: 'invalid' }
  }
}

/**
 * The element states the canvas draws for one step of the machine — node ids and edge ids to the
 * G6 states they are in. One map, handed to `setElementState` whole, so an element that LEAVES a
 * state (withheld at S2, lit at S3) is told so rather than keeping the last one it was given.
 *
 *   frontier   enters in this state          lit   rendered since an earlier state
 *   withheld   waits for a later state        orthogonal   outside the sequence (a shim)
 *   selected   the node the inspector shows   cycle        a member of the loop that stops the machine
 *
 * And an edge being drawn (S4b), which lights only what it touches (06:72-73):
 *   drawSource   the node a drag started on    legalTarget   a node the edge may land on
 *   pendingFrom  the dependent of the edge the inspector is asking about, and pendingTo its dependency
 *   — the two ends of a pending edge are highlighted in place of a dashed edge in the graph data,
 *   which would be a re-layout (S4 decision D10).
 *
 * Edges: `lit` when both ends render in this state, `withheld` when the dependent waits. Nothing
 * else: an edge into a node that is lit only once its dependency is ready is still a lit edge.
 */
/** What an edge being drawn lights: the drag's source and where it may land, or a pending edge's two ends. */
export interface DrawingStates {
  source?: string | null
  legal?: readonly string[]
  pendingFrom?: string | null
  pendingTo?: string | null
}

export const elementStates = (
  graph: ArchitectureGraph,
  model: StepperModel | null,
  selected: string | null,
  cycle: readonly string[] = [],
  drawing: DrawingStates = {},
): Record<string, string[]> => {
  const legal = new Set(drawing.legal)
  const frontier = new Set(model?.frontier)
  const lit = new Set(model?.lit)
  const withheld = new Set(model?.withheld)
  const orthogonal = new Set(model?.orthogonal)
  const looped = new Set(cycle)
  const out: Record<string, string[]> = {}
  for (const node of graph.nodes) {
    const states: string[] = []
    if (frontier.has(node.id)) {
      states.push('frontier')
    } else if (lit.has(node.id)) {
      states.push('lit')
    } else if (withheld.has(node.id)) {
      states.push('withheld')
    }
    if (orthogonal.has(node.id) || node.data.orthogonal) { states.push('orthogonal') }
    if (looped.has(node.id)) { states.push('cycle') }
    if (node.id === selected) { states.push('selected') }
    if (node.id === drawing.source) { states.push('drawSource') }
    if (legal.has(node.id)) { states.push('legalTarget') }
    if (node.id === drawing.pendingFrom) { states.push('pendingFrom') }
    if (node.id === drawing.pendingTo) { states.push('pendingTo') }
    out[node.id] = states
  }
  for (const edge of graph.edges) {
    if (withheld.has(edge.target)) {
      out[edge.id] = ['withheld']
    } else if (lit.has(edge.source) && lit.has(edge.target)) {
      out[edge.id] = ['lit']
    } else {
      out[edge.id] = []
    }
  }
  return out
}

/** The API group an apiVersion names — `core` for the unnamed group (`v1`). */
export const apiGroup = (apiVersion: string): string => {
  const slash = apiVersion.indexOf('/')
  return slash === -1 ? 'core' : apiVersion.slice(0, slash)
}

/**
 * One way out of a state, in words: "every localresources has .status.targetCommitId". The
 * predicate is shown as the descriptor holds it; where it is a class default or missing, the
 * sentence says so, because a default ("exists (no readyWhen)") read as a jq path would mislead.
 */
export const describeLeave = (condition: LeaveCondition): string => {
  const who = condition.all ? `every ${condition.from}` : condition.from
  let what: string
  if (condition.source === 'missing') {
    what = `${who} — no readyWhen is declared, so this edge can never be satisfied; declare one`
  } else if (condition.source === 'default') {
    what = `${who} is ready by its class default (${condition.predicate})`
  } else {
    what = `${who} has ${condition.predicate}`
  }
  return condition.when ? `${what} — only when ${condition.when} is set` : what
}

/** "1 resource", "4 resources" — the counts on the pane head and the file pill. */
export const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`
