/**
 * Child-health rollup — the pure kernel behind "a parent must not read healthier than its worst
 * child".
 *
 * WHY THIS EXISTS. A composition detail page draws its status pill from the composition's OWN
 * `Ready` condition (the chart's `composition-detail-page-header` resolves
 * `.detail.status.conditions | map(select(.type == "Ready"))[0]`), while the composed children are
 * rendered further down the page by the Relations list. Nothing joined the two, so a composition
 * whose managed child is NotReady still opened under a green `Ready` pill: the page reported health
 * from one object about a set of objects.
 *
 * Two facts about Krateo/Crossplane-style conditions make a single-condition read unsafe, and both
 * are encoded here:
 *
 *   1. `Ready` can be STALE. A managed resource keeps `Ready=True` from its last good reconcile
 *      while `Synced=False` carries the live `ReconcileError`. Reading only `Ready` therefore reads
 *      the past. Every condition on a child is enumerated here — never just one type.
 *
 *   2. Readiness is spelled two ways. Krateo resources print `Ready`; core workloads
 *      (Deployment/ReplicaSet) print `Available`. Both are readiness, so both are consulted.
 *
 * VOCABULARY. Every label is a single K8s-native PascalCase token, exactly as the API/kubectl
 * prints it — `Ready`, `NotReady`, `NotSynced`, `Pending`, `ReadyUnknown` (the `<Type>Unknown`
 * form). No invented human phrasing.
 *
 * EXCEPTION-ONLY. `ready` is the steady state and carries no marker: consumers render something
 * only when `worst` is set, which happens only when a child is NOT ready.
 *
 * No React, no fetch, no globals — the whole rule is unit-testable in isolation.
 */

/** One Kubernetes status condition, as the apiserver prints it. */
export interface ConditionLike {
  message?: string
  reason?: string
  status?: string
  type?: string
}

/**
 * The states a child can be in, in K8s terms:
 * - `ready`      — readiness True and nothing contradicting it;
 * - `pending`    — transitional / not observed yet (e.g. a managed child that could not be fetched);
 * - `unknown`    — a condition says `Unknown`, or the child carries nothing judgeable;
 * - `notSynced`  — readiness True but `Synced=False`: the last reconcile FAILED (drift);
 * - `notReady`   — readiness False, or a negative-polarity condition (Degraded/Failed/…) is True.
 */
export type ChildHealthState = 'ready' | 'pending' | 'unknown' | 'notSynced' | 'notReady'

/** One child resource, reduced to what a parent's status has to answer for. */
export interface ChildHealth {
  /** Why, verbatim from the condition that decided the state (`reason · message`). */
  detail: string
  /** SPA route to the child, when the row that reported it carries one. */
  href?: string
  /** Kubernetes kind, as the row prints it (e.g. `Deployment`). */
  kind: string
  name: string
  state: ChildHealthState
}

/** The rollup a parent renders from: worst-of over every reported child. */
export interface ChildHealthRollup {
  /** Every child that is NOT ready, worst first. Empty when the set is clean. */
  exceptions: ChildHealth[]
  readyCount: number
  /** Worst-of over the reported children (`ready` for an empty set — nothing is claimed). */
  state: ChildHealthState
  total: number
  /**
   * The single child a reader should look at, or `undefined` when there is nothing to say —
   * an empty set, or every child ready. The exception-only gate: render nothing without it.
   */
  worst?: ChildHealth
}

/** K8s-native label per state. A pill shows the token; never a sentence. */
export const CHILD_STATE_LABEL: Record<ChildHealthState, string> = {
  notReady: 'NotReady',
  notSynced: 'NotSynced',
  pending: 'Pending',
  ready: 'Ready',
  unknown: 'ReadyUnknown',
}

/**
 * Palette colour per state, per the shipped status-pill spec: green = health ONLY, red = failure,
 * violet = drift, gold/orange = transitional, gray = non-health/unknown.
 */
export const CHILD_STATE_COLOR: Record<ChildHealthState, string> = {
  notReady: 'red',
  notSynced: 'violet',
  pending: 'orange',
  ready: 'green',
  unknown: 'gray',
}

/**
 * Worst-of ordering.
 *
 * `notSynced` outranks `pending`/`unknown` deliberately: `Synced=False` is an ERROR the controller
 * reported on its last pass (`ReconcileError`), whereas pending and unknown are states nobody has
 * concluded anything about yet. It sits below `notReady` because the child is, for now, still
 * serving what it last converged to.
 */
const SEVERITY: Record<ChildHealthState, number> = {
  notReady: 4,
  notSynced: 3,
  pending: 1,
  ready: 0,
  unknown: 2,
}

/** Readiness is spelled `Ready` by Krateo resources and `Available` by core workloads. */
const READINESS_TYPES = ['Ready', 'Available']

/** Conditions whose TRUE is the bad news (Kubernetes' negative-polarity conditions). */
const NEGATIVE_TYPES = ['Degraded', 'Failed', 'ReplicaFailure', 'Unhealthy']

const detailOf = (condition: ConditionLike): string =>
  [condition.reason, condition.message].filter((part) => !!part && part.trim() !== '').join(' · ')

/** Judge ONE condition. `undefined` means this condition type carries no health verdict. */
const judge = (condition: ConditionLike): ChildHealthState | undefined => {
  const status = condition.status ?? ''
  const type = condition.type ?? ''

  if (READINESS_TYPES.includes(type)) {
    if (status === 'True') { return 'ready' }
    if (status === 'False') { return 'notReady' }
    return 'unknown'
  }

  if (type === 'Synced') {
    if (status === 'True') { return 'ready' }
    if (status === 'False') { return 'notSynced' }
    return 'unknown'
  }

  if (NEGATIVE_TYPES.includes(type)) {
    if (status === 'True') { return 'notReady' }
    if (status === 'False') { return 'ready' }
    return 'unknown'
  }

  // A condition type this rule has no polarity for (e.g. a CRD's own bespoke type) is NOT guessed
  // at: guessing would either invent failures or, worse, invent health.
  return undefined
}

/**
 * Reduce a child's FULL condition list to one state — every type, not the first one.
 *
 * An empty or absent list is `unknown`, never `ready`: "nothing was reported" is not "everything is
 * fine". (The chart calls a conditionless kind it successfully FETCHED — a ConfigMap, a
 * ServiceAccount — healthy, and that verdict reaches this module through the resolved row state,
 * not through conditions.)
 */
export const childStateFromConditions = (conditions: ConditionLike[] | undefined): { detail: string; state: ChildHealthState } => {
  const list = Array.isArray(conditions) ? conditions : []
  let state: ChildHealthState = 'unknown'
  let detail = ''
  let judged = false

  for (const condition of list) {
    const verdict = judge(condition)
    if (!verdict) { continue }
    if (!judged || SEVERITY[verdict] > SEVERITY[state]) {
      state = verdict
      detail = verdict === 'ready' ? '' : detailOf(condition)
    }
    judged = true
  }

  return { detail, state }
}

/**
 * Map a resolved status COLOUR to a state.
 *
 * The composition detail Relations rows arrive with their state already decided server-side (the
 * `composition-resources` RESTAction folds fetch-failure, Ready, Synced and conditionless kinds
 * into one token) and delivered to the widget as a palette colour. The colour→severity direction is
 * not an invention here: the status-pill spec fixes it (green = health only, red = failure,
 * violet = drift, gold = transitional, everything else = non-health), so a row that paints red
 * cannot leave its parent green.
 */
export const childStateFromStatusColor = (color: string | undefined): ChildHealthState => {
  switch (color) {
    case 'green':
    case 'success':
      return 'ready'
    case 'error':
    case 'red':
      return 'notReady'
    case 'magenta':
    case 'violet':
      return 'notSynced'
    case 'amber':
    case 'gold':
    case 'orange':
    case 'warning':
      return 'pending'
    default:
      return 'unknown'
  }
}

/** What a rendered child row can tell us about the resource behind it. */
export interface RowHealthInput {
  /** The row's resolved palette colour (used when the row carries no raw conditions). */
  color?: string
  /** The child's RAW conditions, when the row's data element carries them — always preferred. */
  conditions?: ConditionLike[]
  href?: string
  kind?: string
  name?: string
}

/**
 * Build a `ChildHealth` from one rendered row: raw conditions when the data has them (the honest
 * source), the resolved status colour otherwise (all the row has).
 */
export const childHealthFromRow = ({ color, conditions, href, kind, name }: RowHealthInput): ChildHealth => {
  const hasConditions = Array.isArray(conditions) && conditions.length > 0
  const { detail, state } = hasConditions
    ? childStateFromConditions(conditions)
    : { detail: '', state: childStateFromStatusColor(color) }

  return { detail, href, kind: kind ?? '', name: name ?? '', state }
}

/**
 * Worst-of rollup. A parent reads as its worst child, never as its average and never as itself.
 *
 * An EMPTY set returns `worst: undefined` and `total: 0`: no children were reported, so there is
 * nothing to say — and saying nothing is right, because claiming health for an unobserved set is
 * exactly the bug this module exists to stop.
 */
export const rollupChildHealth = (children: ChildHealth[]): ChildHealthRollup => {
  const list = Array.isArray(children) ? children : []
  const exceptions = list
    .filter((child) => child.state !== 'ready')
    .sort((left, right) => SEVERITY[right.state] - SEVERITY[left.state])

  const state = list.reduce<ChildHealthState>(
    (worst, child) => (SEVERITY[child.state] > SEVERITY[worst] ? child.state : worst),
    'ready',
  )

  return {
    exceptions,
    readyCount: list.filter((child) => child.state === 'ready').length,
    state,
    total: list.length,
    worst: exceptions[0],
  }
}

/**
 * One line naming WHICH child is not ready and WHY — the tooltip a parent's exception pill carries,
 * so the reader is not left knowing only that "something" is wrong.
 */
export const describeChildHealth = (rollup: ChildHealthRollup): string => {
  const { exceptions, total, worst } = rollup
  if (!worst) { return '' }

  const ref = [worst.kind, worst.name].filter(Boolean).join('/') || 'child'
  const head = `${exceptions.length} of ${total} ${total === 1 ? 'child' : 'children'} not Ready`
  const why = worst.detail ? ` (${worst.detail})` : ''
  const rest = exceptions.length > 1 ? `; +${exceptions.length - 1} more` : ''

  return `${head} — ${CHILD_STATE_LABEL[worst.state]}: ${ref}${why}${rest}`
}
