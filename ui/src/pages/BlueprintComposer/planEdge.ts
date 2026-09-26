/**
 * Edges — the kernel behind drawing one, the inspector's Depends-on rows, a node's Ready when, and
 * Remove from chart. Pure: each takes the held files and answers with the batch that makes the change,
 * or the refusal that says why not and where the edge COULD go. Nothing here writes; the composer
 * emits the plan on the batch bus, and the provider writes all of it or none (previewFilesBatch).
 *
 * ONE KERNEL, WHOEVER ASKS — a person dragging, a person choosing in a Select, and (S5) the agent's
 * `chartLink`, which calls `planEdge` unchanged: a dependency a person could not declare, the agent
 * cannot either. `from` is the DEPENDENT and `to` the DEPENDENCY (the descriptor's `dependsOn`).
 *
 * LEGAL, OR REFUSED IN WORDS:
 *   - both ends exist; an edge from a node to itself, a second edge between the same pair, an edge
 *     onto or out of a lifecycle node — each refused;
 *   - no cycle: `to` must not already depend, transitively, on `from`. The refusal names the loop,
 *     `to → … → from → to`, and every target that WOULD be legal (`legalEdgeTargets`, O(V+E));
 *   - `ready` needs something to compile: a readyWhen on the target, else its class default (a
 *     composition's Ready and Synced, a native kind's kstatus). A custom resource has none.
 *
 * AN EDGE IS THE DESCRIPTOR AND THE GATE, at once (screen 7): the dependent's `dependsOn` in
 * templates/architecture.yaml, and the `krateo:gate` block in its template (gateGen), regenerated —
 * or removed with its last dependency. The edge's `when` defaults to the target's own (a gate waits
 * only when the thing it waits for is rendered at all), and `all` is set whenever the target ranges.
 *
 * `readyWhen` BELONGS TO THE TARGET, not to one edge (S4 decision D18): setting it re-gates EVERY
 * dependent with a `ready` edge onto that node, in the same batch, and the plan lists them.
 *
 * NAMES STAY IN THE DESCRIPTOR (S11). The gate looks a target up by the descriptor's `name`, the same
 * one the graph block evaluates — so a target that has none gets it here, from its template
 * (nameExpressionOf), and the descriptor carries it from then on. The graph block itself is the
 * draft store's to regenerate (`settle`), from the descriptor this plan writes.
 *
 * A HAND-WRITTEN GATE IS NEVER TOUCHED: a template carrying a `lookup` outside a marked block is
 * refused, with its line — the composer will not add a second gate beside a person's.
 */
import {
  ARCHITECTURE_TEMPLATE_PATH,
  lifecycleRefusal,
  parseArchitecture,
  rewrapDescriptor,
  serializeArchitecture,
  type ChartArchitecture,
  type Dependency,
  type ResourceNode,
} from './architecture'
import { applyGate, removeGate, renderGatePreamble, unmanagedLookups, type ApplyResult, type GateRefusalCode } from './gateGen'
import { nameExpressionOf } from './nameExpression'
import { readDescriptor, setForEach, type DescriptorRead } from './planPlace'
import { parseReadyWhen, readinessGuard } from './readyWhen'

export type EdgeOp =
  | { op: 'add'; from: string; to: string; ready?: boolean; readyWhen?: string | null; when?: string }
  | { op: 'set'; from: string; to: string; ready?: boolean; readyWhen?: string | null; when?: string | null }
  | { op: 'remove'; from: string; to: string }

export type EdgeRefusalCode = 'unknown-node' | 'self' | 'duplicate' | 'missing-edge' | 'lifecycle' | 'lifecycle-source' | 'cycle'
  | 'needs-readyWhen' | 'bad-readyWhen' | 'no-template' | 'no-name' | 'unmanaged-gate' | 'malformed-gate' | 'descriptor' | 'unchanged' | 'for-each'

export type EdgeRefusal = { ok: false; code: EdgeRefusalCode; reason: string; where: string[]; cycle?: string[]; path?: string; line?: number }

export type EdgePlan = { ok: true; edit: Record<string, string>; expect: Record<string, string>; regated: string[] } | EdgeRefusal

export type RemovePlan = { ok: true; edit: Record<string, string>; remove: string[]; expect: Record<string, string>; regated: string[] } | EdgeRefusal

type Files = Readonly<Record<string, string>>

const NOTHING_WRITTEN = 'Nothing was written.'

const refuse = (code: EdgeRefusalCode, reason: string, extra: Partial<EdgeRefusal> = {}): EdgeRefusal => ({ code, ok: false, reason, where: [], ...extra })

/** "a", "a or b", "a, b or c". */
export const orList = (items: readonly string[]): string =>
  (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items.join(''))

/** Own keys only: a template path named `constructor` is not a file the chart holds. */
const holds = (files: Files, path: string): boolean => Object.prototype.hasOwnProperty.call(files, path)

/**
 * Where an edge out of `from` may go, in descriptor order — and why each other node may not. One
 * pass builds who-depends-on-whom, one walk finds everything that already waits on `from`: an edge
 * onto any of those closes a loop.
 */
export const legalEdgeTargets = (arch: ChartArchitecture, from: string): { legal: string[]; refused: Record<string, string> } => {
  const source = arch.resources.find((node) => node.id === from)
  const legal: string[] = []
  const refused: Record<string, string> = {}
  if (!source) { return { legal, refused } }
  const dependents = new Map<string, string[]>()
  let existing: Dependency[] = []
  for (const node of arch.resources) {
    const deps = node.dependsOn ?? []
    if (node === source) { existing = deps }
    for (const dep of deps) { dependents.set(dep.ref, [...(dependents.get(dep.ref) ?? []), node.id]) }
  }
  const waiting = new Set<string>()
  const queue = [from]
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of dependents.get(queue[head]) ?? []) {
      if (!waiting.has(next)) {
        waiting.add(next)
        queue.push(next)
      }
    }
  }
  const already = new Set(existing.map((dep) => dep.ref))
  for (const node of arch.resources) {
    if (node.id === from) { continue }
    if (source.lifecycle) {
      refused[node.id] = `${from} is lifecycle: ${source.lifecycle} — it waits for nothing`
    } else if (node.lifecycle) {
      refused[node.id] = `lifecycle: ${node.lifecycle} — nothing can wait on it`
    } else if (already.has(node.id)) {
      refused[node.id] = 'already a dependency'
    } else if (waiting.has(node.id)) {
      refused[node.id] = 'would be a cycle'
    } else {
      legal.push(node.id)
    }
  }
  return { legal, refused }
}

/** The chain of dependencies from `start` down to `goal` (`start → … → goal`), or null when there is none. */
const dependencyPath = (arch: ChartArchitecture, start: string, goal: string): string[] | null => {
  const byId = new Map(arch.resources.map((node) => [node.id, node]))
  const parent = new Map<string, string>([[start, start]])
  const queue = [start]
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]
    if (at === goal) {
      const path = [at]
      while (path[0] !== start) { path.unshift(parent.get(path[0]) ?? start) }
      return path
    }
    for (const dep of byId.get(at)?.dependsOn ?? []) {
      if (!parent.has(dep.ref)) {
        parent.set(dep.ref, at)
        queue.push(dep.ref)
      }
    }
  }
  return null
}

/** Why `ready` onto `target` has nothing to wait for — or null when its readiness compiles. */
const readinessGap = (target: ResourceNode): string | null => {
  if (readinessGuard(target, 0, '""').ok) { return null }
  const why = target.class === 'custom' ? 'a custom resource has no default' : `the composer knows no default for ${target.kind}`
  return `Pick what “ready” means for ${target.id} — ${why}. Or turn off Wait for readiness: then it only has to exist.`
}

const withNode = (arch: ChartArchitecture, id: string, change: (node: ResourceNode) => ResourceNode): ChartArchitecture =>
  ({ ...arch, resources: arch.resources.map((node) => (node.id === id ? change(node) : node)) })

/** A node with `readyWhen` set (a string), cleared (null), or left (undefined). */
const withReadyWhen = (node: ResourceNode, readyWhen: string | null | undefined): ResourceNode => {
  if (readyWhen === undefined) { return node }
  const { readyWhen: _dropped, ...rest } = node
  return readyWhen ? { ...rest, readyWhen } : rest
}

const edgeOf = (target: ResourceNode, ready: boolean, when: string | undefined): Dependency => {
  const edge: Dependency = { ref: target.id }
  if (ready) { edge.ready = true }
  if (target.forEach) { edge.all = true }
  if (when) { edge.when = when }
  return edge
}

/** The descriptor after `op`, when the edge is legal — the one legality check every caller shares. */
export const checkEdge = (arch: ChartArchitecture, op: EdgeOp): { ok: true; next: ChartArchitecture } | EdgeRefusal => {
  const from = arch.resources.find((node) => node.id === op.from)
  const to = arch.resources.find((node) => node.id === op.to)
  const where = (): string[] => legalEdgeTargets(arch, op.from).legal
  if (!from || !to) {
    return refuse('unknown-node', `${from ? op.to : op.from} is not a resource of this chart. ${NOTHING_WRITTEN}`)
  }
  const existing = from.dependsOn?.find((dep) => dep.ref === to.id)
  if (op.op === 'remove') {
    if (!existing) { return refuse('missing-edge', `${from.id} does not depend on ${to.id} — there is no edge to remove. ${NOTHING_WRITTEN}`) }
    return { next: withNode(arch, from.id, (node) => ({ ...node, dependsOn: (node.dependsOn ?? []).filter((dep) => dep.ref !== to.id) })), ok: true }
  }
  if (from === to) {
    return refuse('self', `${from.id} cannot depend on itself. ${NOTHING_WRITTEN}`, { where: where() })
  }
  if (op.op === 'add' && existing) {
    return refuse('duplicate', `${from.id} already depends on ${to.id} — change that edge in the inspector instead.`, { where: where() })
  }
  if (op.op === 'set' && !existing) {
    return refuse('missing-edge', `${from.id} does not depend on ${to.id} — there is no edge to change. ${NOTHING_WRITTEN}`)
  }
  if (from.lifecycle) {
    return refuse('lifecycle-source', `"${from.id}" is lifecycle: ${from.lifecycle} — outside the sequence, so it waits for nothing. ${NOTHING_WRITTEN}`)
  }
  if (to.lifecycle) {
    return refuse('lifecycle', lifecycleRefusal(to.id, to.lifecycle), { where: where() })
  }
  if (op.op === 'add') {
    const path = dependencyPath(arch, to.id, from.id)
    if (path) {
      const cycle = [...path, to.id]
      const legal = where()
      const instead = legal.length ? ` It could depend on ${orList(legal)} instead.` : ''
      return refuse('cycle', `${cycle.join(' → ')} would be a cycle. ${NOTHING_WRITTEN}${instead}`, { cycle, where: legal })
    }
  }
  if (typeof op.readyWhen === 'string') {
    const parsed = parseReadyWhen(op.readyWhen)
    if (!parsed.ok) { return refuse('bad-readyWhen', `${parsed.reason}. ${NOTHING_WRITTEN}`, { where: where() }) }
  }
  const target = withReadyWhen(to, op.readyWhen)
  const ready = op.ready ?? (op.op === 'set' ? existing?.ready === true : false)
  const gap = ready ? readinessGap(target) : null
  if (gap) {
    return refuse('needs-readyWhen', gap, { where: where() })
  }
  let when = op.op === 'add' ? op.when ?? to.when : existing?.when
  if (op.op === 'set' && op.when !== undefined) { when = op.when ?? undefined }
  const edge = edgeOf(target, ready, when)
  const next = withNode(withNode(arch, to.id, () => target), from.id, (node) => {
    const deps = node.dependsOn ?? []
    return { ...node, dependsOn: existing ? deps.map((dep) => (dep.ref === to.id ? edge : dep)) : [...deps, edge] }
  })
  return { next, ok: true }
}

const GATE_CODES: Record<GateRefusalCode, EdgeRefusalCode> = { 'needs-readyWhen': 'needs-readyWhen', 'no-name': 'no-name', shape: 'malformed-gate' }

/**
 * A name for every target a gated node looks up — the descriptor's, or its template's (written into
 * the descriptor, so the graph block evaluates the same one) — or the refusal that says whose is missing.
 */
const withNames = (files: Files, arch: ChartArchitecture, gated: readonly string[]): { ok: true; arch: ChartArchitecture } | EdgeRefusal => {
  let next = arch
  const targets = new Set(gated.flatMap((id) => (next.resources.find((node) => node.id === id)?.dependsOn ?? []).map((dep) => dep.ref)))
  for (const id of targets) {
    const target = next.resources.find((node) => node.id === id)
    if (!target || target.name) { continue }
    if (!holds(files, target.template)) {
      return refuse('no-name', `The composer cannot tell what ${id} is named: its template ${target.template} is not in the chart. ${NOTHING_WRITTEN}`, { path: target.template })
    }
    const named = nameExpressionOf(files[target.template], { id, path: target.template })
    if (!named.ok) { return refuse('no-name', named.reason, { path: target.template }) }
    next = withNode(next, id, (node) => ({ ...node, name: named.expr }))
  }
  return { arch: next, ok: true }
}

/** The gated nodes' templates, regenerated from `arch` (or ungated, with no dependency left), and the descriptor rewritten. */
const gatePlan = (files: Files, read: Extract<DescriptorRead, { ok: true }>, arch: ChartArchitecture, gated: readonly string[], regated: string[]): EdgePlan => {
  const named = withNames(files, arch, gated)
  if (!named.ok) { return named }
  const next = named.arch
  const edit: Record<string, string> = {}
  const expect: Record<string, string> = {}
  for (const id of gated) {
    const node = next.resources.find((resource) => resource.id === id)
    if (!node) { continue }
    const path = node.template
    if (!holds(files, path)) {
      return refuse('no-template', `${id}'s template ${path} is not in the chart, so there is nothing to gate. ${NOTHING_WRITTEN}`, { path })
    }
    const text = files[path]
    const hand = unmanagedLookups(text)
    if (hand.length) {
      return refuse('unmanaged-gate', `${path} already gates itself with a hand-written lookup (line ${hand[0]}), so the composer will not add a second gate there. ${NOTHING_WRITTEN}`, { line: hand[0], path })
    }
    let result: ApplyResult
    if (node.dependsOn?.length) {
      const preamble = renderGatePreamble(node, next)
      if (!preamble.ok) { return refuse(GATE_CODES[preamble.code], `${preamble.reason}. ${NOTHING_WRITTEN}`, { path }) }
      result = applyGate(text, preamble.block)
    } else {
      result = removeGate(text)
    }
    if (!result.ok) { return refuse('malformed-gate', `${path}: ${result.reason}. ${NOTHING_WRITTEN}`, { path }) }
    if (result.text !== text) {
      edit[path] = result.text
      expect[path] = text
    }
  }
  const descriptor = serializeArchitecture(next)
  const reparsed = parseArchitecture(descriptor)
  const rewrapped = reparsed.ok ? rewrapDescriptor(read.template, descriptor) : null
  if (!reparsed.ok || rewrapped === null) {
    const problem = reparsed.ok ? 'the architecture file carries no data.architecture block' : `${reparsed.problems[0].path} — ${reparsed.problems[0].message}`
    return refuse('descriptor', `The architecture file would not be readable after this change (${problem}). ${NOTHING_WRITTEN}`)
  }
  edit[ARCHITECTURE_TEMPLATE_PATH] = rewrapped
  expect[ARCHITECTURE_TEMPLATE_PATH] = read.template
  return { edit, expect, ok: true, regated }
}

const held = (files: Files): Extract<DescriptorRead, { ok: true }> | EdgeRefusal => {
  const read = readDescriptor(files)
  return read.ok ? read : refuse('descriptor', read.reason)
}

/**
 * EVERY node's gate regenerated from the descriptor — for a tree that arrives WHOLE (Autopilot's
 * previewBlueprint), where no edge was drawn in the composer to trigger `planEdge`. The agent
 * declares edges and never writes a gate; without this the edges it declared were drawn on the
 * canvas and the detail page but NOT enforced when the chart rendered. The same kernel the composer
 * uses for one edge (gatePlan), over all nodes: idempotent, and it never touches a hand-written
 * lookup. A refusal leaves the tree as it came — the lint and the gate report why.
 */
export const regenerateGates = (files: Files): Files => {
  const read = readDescriptor(files)
  if (!read.ok) { return files }
  const ids = read.architecture.resources.map((node) => node.id)
  const plan = gatePlan(files, read, read.architecture, ids, [])
  if (!plan.ok) { return files }
  const changed = Object.entries(plan.edit).filter(([path, text]) => files[path] !== text)
  return changed.length ? { ...files, ...Object.fromEntries(changed) } : files
}

/** Every node with a `ready` edge onto `id` — what a change to `id`'s readiness re-gates. */
const readyDependents = (arch: ChartArchitecture, id: string): string[] =>
  arch.resources.filter((node) => node.dependsOn?.some((dep) => dep.ref === id && dep.ready)).map((node) => node.id)

/** Add, change or remove one edge: the descriptor, the dependent's gate, and any dependent a new readyWhen re-gates. */
export const planEdge = (files: Files, op: EdgeOp): EdgePlan => {
  const read = held(files)
  if (!read.ok) { return read }
  const checked = checkEdge(read.architecture, op)
  if (!checked.ok) { return checked }
  const before = read.architecture.resources.find((node) => node.id === op.to)
  const readyWhen = op.op === 'remove' ? undefined : op.readyWhen
  const changed = readyWhen !== undefined && (readyWhen || undefined) !== before?.readyWhen
  const regated = changed ? readyDependents(read.architecture, op.to).filter((id) => id !== op.from) : []
  return gatePlan(files, read, checked.next, [op.from, ...regated], regated)
}

/** Set (or clear) a node's own readyWhen — and re-gate every dependent that waits for it to be ready. */
export const planReadyWhen = (files: Files, id: string, readyWhen: string | null): EdgePlan => {
  const read = held(files)
  if (!read.ok) { return read }
  const node = read.architecture.resources.find((resource) => resource.id === id)
  if (!node) { return refuse('unknown-node', `${id} is not a resource of this chart. ${NOTHING_WRITTEN}`) }
  if (readyWhen !== null) {
    const parsed = parseReadyWhen(readyWhen)
    if (!parsed.ok) { return refuse('bad-readyWhen', `${parsed.reason}. ${NOTHING_WRITTEN}`) }
  }
  if ((readyWhen ?? undefined) === node.readyWhen) {
    return refuse('unchanged', `${id} is already ready ${readyWhen ? `when ${readyWhen}` : 'by its class default'} — nothing to change.`)
  }
  const dependents = readyDependents(read.architecture, id)
  const target = withReadyWhen(node, readyWhen)
  if (dependents.length && readinessGap(target)) {
    return refuse('needs-readyWhen', `${orList(dependents)} ${dependents.length === 1 ? 'waits' : 'wait'} for ${id} to be ready, and without a readyWhen there is nothing to wait for — turn off their Wait for readiness first. ${NOTHING_WRITTEN}`)
  }
  return gatePlan(files, read, withNode(read.architecture, id, () => target), dependents, dependents)
}

/**
 * Remove a node from the chart (S4 decision D19): its entry, every edge onto it, and its template —
 * and every dependent re-gated without it (its gate removed with its last dependency).
 */
export const planRemoveNode = (files: Files, id: string): RemovePlan => {
  const read = held(files)
  if (!read.ok) { return read }
  const node = read.architecture.resources.find((resource) => resource.id === id)
  if (!node) { return refuse('unknown-node', `${id} is not a resource of this chart. ${NOTHING_WRITTEN}`) }
  const dependents = read.architecture.resources.filter((resource) => resource.dependsOn?.some((dep) => dep.ref === id)).map((resource) => resource.id)
  const next: ChartArchitecture = {
    ...read.architecture,
    resources: read.architecture.resources
      .filter((resource) => resource.id !== id)
      .map((resource) => (dependents.includes(resource.id) ? { ...resource, dependsOn: (resource.dependsOn ?? []).filter((dep) => dep.ref !== id) } : resource)),
  }
  const plan = gatePlan(files, read, next, dependents, dependents)
  if (!plan.ok) { return plan }
  const shared = next.resources.some((resource) => resource.template === node.template)
  const remove = holds(files, node.template) && !shared ? [node.template] : []
  const expect = { ...plan.expect, ...Object.fromEntries(remove.map((path) => [path, files[path]])) }
  return { edit: plan.edit, expect, ok: true, regated: plan.regated, remove }
}

/**
 * "One per item of" on a node edges touch (planPlace's setForEach, made gate-aware). The node's own
 * gate comes off, the template is ranged — or un-ranged — exactly as placing would write it, and the
 * gate goes back on INSIDE the new range; every edge onto the node gains (or loses) `all`, and every
 * dependent's gate is regenerated for the per-item names. One batch: ranging a node must never leave
 * a dependent looking up a name the chart no longer creates.
 */
export const planSetForEach = (files: Files, id: string, forEach: string | null): EdgePlan => {
  const read = held(files)
  if (!read.ok) { return read }
  const node = read.architecture.resources.find((resource) => resource.id === id)
  if (!node) { return refuse('unknown-node', `${id} is not a resource of this chart. ${NOTHING_WRITTEN}`) }
  const ungated = holds(files, node.template) ? removeGate(files[node.template]) : null
  if (ungated && !ungated.ok) { return refuse('malformed-gate', `${node.template}: ${ungated.reason}. ${NOTHING_WRITTEN}`, { path: node.template }) }
  const staged = ungated ? { ...files, [node.template]: ungated.text } : files
  const ranged = setForEach(staged, id, forEach)
  if (!ranged.ok) { return refuse('for-each', ranged.reason) }
  const after = { ...staged, ...ranged.edit }
  const reread = held(after)
  if (!reread.ok) { return reread }
  // An edge onto a ranged node waits for every item (`all`); onto a single one, for it alone.
  const rewired = (dep: Dependency): Dependency => {
    const { all: _all, ...rest } = dep
    return forEach?.trim() ? { ...rest, all: true } : rest
  }
  const dependents = reread.architecture.resources.filter((resource) => resource.dependsOn?.some((dep) => dep.ref === id)).map((resource) => resource.id)
  const next: ChartArchitecture = {
    ...reread.architecture,
    resources: reread.architecture.resources.map((resource) => (dependents.includes(resource.id)
      ? { ...resource, dependsOn: (resource.dependsOn ?? []).map((dep) => (dep.ref === id ? rewired(dep) : dep)) }
      : resource)),
  }
  const plan = gatePlan(after, reread, next, [...(node.dependsOn?.length ? [id] : []), ...dependents], dependents)
  if (!plan.ok) { return plan }
  const edit = { ...ranged.edit, ...plan.edit }
  return { edit, expect: Object.fromEntries(Object.keys(edit).map((path) => [path, files[path]])), ok: true, regated: dependents }
}
