/**
 * WHAT THE LIVE PREVIEW ACTUALLY SHOWED (frontend#442 D10, autopilot#147).
 *
 * A page the builder gate passed can still render nothing useful: a table with no rows, a pie with
 * no slices, a chart whose rows lack the field it plots, or a widget whose RESTAction failed to
 * resolve (snowplow answers that widget with an error, and the portal draws the red card). The gate
 * judges the objects; only the render judges the data. Until now the render was seen by the person
 * alone — the agent handed the page back and called it done.
 *
 * This module reads the preview's widgets out of the live react-query cache, the same cache the
 * drawer renders from, and says in a few factual lines what each one showed. The provider uses it
 * to run ONE automatic follow-up turn when the preview has problems, bounded by `createPreviewDataLoop`.
 *
 * Generic on purpose: the checks know widget KINDS and the fields their schemas declare (a chart's
 * `data` and the field it plots, a table's `dataSource`), never a page, a use case or a RESTAction.
 */

import { sandboxDraftName } from './previewSandbox'

/** One widget query as the cache holds it — what WidgetRenderer reads to draw the widget. */
export interface RenderedWidgetState {
  endpoint: string
  /** The query's data: the widget envelope snowplow served (or `{pages: […]}` for an infinite query). */
  data: unknown
  loadState: 'loading' | 'error' | 'ready'
  /** The fetch failure, when `loadState` is `error`: the HTTP status and the backend's own words. */
  error?: { status?: number; message: string }
  /** When the query last settled (data or error), ms epoch. */
  updatedAt: number
}

/** A previewed widget, by the name it has IN THE SANDBOX, back to the name and kind it was authored with. */
export type PreviewWidgetNames = ReadonlyMap<string, { kind: string; name: string }>

export type PreviewProblemCategory = 'error' | 'empty' | 'missing-series' | 'no-value' | 'loading'

export interface PreviewRenderProblem {
  /** `<Kind> <authored name>`. */
  widget: string
  category: PreviewProblemCategory
  detail: string
}

export interface PreviewRenderSummary {
  problems: PreviewRenderProblem[]
  /** What rendered WITH data, one line per data widget (`Table pods: 148 rows`). */
  rendered: string[]
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * The previewed widgets by their SANDBOX name (owner-scoped, `sandboxDraftName`), back to the name
 * and kind they were authored with — the names the specialist knows them by.
 */
export const previewWidgetNames = (widgets: readonly Record<string, unknown>[], owner: string): PreviewWidgetNames => {
  const names = new Map<string, { kind: string; name: string }>()
  for (const widget of widgets) {
    const name = asRecord(widget.metadata)?.name
    if (typeof name === 'string' && name) {
      names.set(sandboxDraftName(name, owner), { kind: typeof widget.kind === 'string' ? widget.kind : 'Widget', name })
    }
  }
  return names
}

const MAX_DETAIL = 400
const MAX_LINES = 12

/** The widget cache uses useInfiniteQuery: unwrap the last page, the fullest widget state. */
const unwrapWidget = (data: unknown): Record<string, unknown> | undefined => {
  const pages = asRecord(data)?.pages
  return asRecord(Array.isArray(pages) && pages.length ? pages[pages.length - 1] : data)
}

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

/** The `name` / `namespace` query params of a widget endpoint (`/call?resource=…&name=…`). */
export const endpointParams = (endpoint: string): { name?: string; namespace?: string } => {
  const query = endpoint.includes('?') ? endpoint.slice(endpoint.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  return { name: params.get('name') ?? undefined, namespace: params.get('namespace') ?? undefined }
}

const isNumeric = (value: unknown): boolean =>
  (typeof value === 'number' && Number.isFinite(value))
  || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== ''

const fieldOf = (widgetData: Record<string, unknown>, key: string): string | undefined => {
  const value = widgetData[key]
  return typeof value === 'string' && value ? value : undefined
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** What a chart kind calls one row of its `data`, and the field holding the value it plots. */
const CHARTS: Record<string, { unit: string; valueField: string; positionField?: string }> = {
  BarChart: { positionField: 'xField', unit: 'bar', valueField: 'yField' },
  LineChart: { positionField: 'xField', unit: 'point', valueField: 'yField' },
  PieChart: { positionField: 'colorField', unit: 'slice', valueField: 'angleField' },
}

type Verdict = { problem: Omit<PreviewRenderProblem, 'widget'> } | { rendered: string } | null

const inspectChart = (kind: string, widgetData: Record<string, unknown>): Verdict => {
  const { positionField, unit, valueField } = CHARTS[kind]
  const { data } = widgetData
  if (!Array.isArray(data)) {
    return { problem: { category: 'empty', detail: `no ${unit}s: \`data\` resolved to ${data === undefined ? 'nothing' : JSON.stringify(data)}` } }
  }
  if (!data.length) {
    return { problem: { category: 'empty', detail: `no ${unit}s: \`data\` is an empty list` } }
  }
  const rows = data.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row))
  const value = fieldOf(widgetData, valueField)
  if (value && !rows.some((row) => isNumeric(row[value]))) {
    return { problem: { category: 'missing-series', detail: `${plural(data.length, 'row')}, but none has a numeric \`${value}\` (its ${valueField})` } }
  }
  const position = positionField ? fieldOf(widgetData, positionField) : undefined
  if (position && !rows.some((row) => hasValue(row[position]))) {
    return { problem: { category: 'missing-series', detail: `${plural(data.length, 'row')}, but none has \`${position}\` (its ${positionField})` } }
  }
  const color = kind === 'PieChart' ? undefined : fieldOf(widgetData, 'colorField')
  if (color && !rows.some((row) => hasValue(row[color]))) {
    return { problem: { category: 'missing-series', detail: `${plural(data.length, 'row')}, but none has \`${color}\` (its colorField), so no series is drawn` } }
  }
  const series = color ? new Set(rows.map((row) => String(row[color]))).size : 0
  return { rendered: `${plural(data.length, unit)}${series > 1 ? ` in ${series} series` : ''}` }
}

const inspectRows = (widgetData: Record<string, unknown>, unit: string): Verdict => {
  const source = widgetData.dataSource ?? (unit === 'item' ? widgetData.items : undefined)
  if (!Array.isArray(source)) {
    return { problem: { category: 'empty', detail: `no ${unit}s: \`dataSource\` resolved to ${source === undefined ? 'nothing' : JSON.stringify(source)}` } }
  }
  if (!source.length) {
    return { problem: { category: 'empty', detail: `empty: 0 ${unit}s` } }
  }
  return { rendered: plural(source.length, unit) }
}

/** The data verdict for one resolved widget, by kind. Containers and static widgets have none. */
const inspectData = (kind: string, widgetData: Record<string, unknown> | undefined): Verdict => {
  const dataKind = kind in CHARTS || kind === 'Table' || kind === 'List' || kind === 'Statistic'
  if (!dataKind) {
    return null
  }
  if (!widgetData) {
    return { problem: { category: 'empty', detail: 'no widgetData was resolved' } }
  }
  if (kind in CHARTS) {
    return inspectChart(kind, widgetData)
  }
  if (kind === 'Table') {
    return inspectRows(widgetData, 'row')
  }
  if (kind === 'List') {
    // A List that hides itself when empty is DESIGNED to be empty sometimes: nothing to report.
    return widgetData.hideWhenEmpty === true ? null : inspectRows(widgetData, 'item')
  }
  return hasValue(widgetData.value)
    ? { rendered: `value ${String(widgetData.value)}` }
    : { problem: { category: 'no-value', detail: '`value` resolved to nothing' } }
}

const describeError = (error: RenderedWidgetState['error']): string => {
  if (!error) {
    return 'failed to load'
  }
  const prefixes: Record<number, string> = { 403: 'forbidden (403)', 404: 'not found (404)' }
  let prefix = 'failed to load'
  if (error.status) {
    prefix = prefixes[error.status] ?? `failed to load (${error.status})`
  }
  return clip(`${prefix}: ${error.message}`)
}

/**
 * What one previewed widget showed: a problem, a rendered fact, or nothing worth a line.
 * `timedOut` turns a widget still loading into a problem of its own — a preview that never finished
 * is not one that showed data.
 */
export const inspectRenderedWidget = (
  state: RenderedWidgetState,
  identity: { kind: string; name: string },
  timedOut: boolean,
): PreviewRenderProblem | { widget: string; rendered: string } | null => {
  const root = unwrapWidget(state.data)
  const kind = typeof root?.kind === 'string' && root.kind !== 'Status' ? root.kind : identity.kind
  const widget = `${kind} ${identity.name}`
  if (state.loadState === 'loading') {
    return timedOut ? { category: 'loading', detail: 'still loading when the check gave up', widget } : null
  }
  if (state.loadState === 'error') {
    return { category: 'error', detail: describeError(state.error), widget }
  }
  // snowplow answered with a Status instead of the widget (an unresolvable widget).
  if (typeof root?.status === 'string') {
    const code = typeof root.code === 'number' ? ` (${root.code})` : ''
    return { category: 'error', detail: clip(`the server answered ${root.status}${code}: ${typeof root.message === 'string' ? root.message : 'no message'}`), widget }
  }
  const status = asRecord(root?.status)
  if (typeof status?.error === 'string' && status.error) {
    return { category: 'error', detail: clip(status.error), widget }
  }
  const verdict = inspectData(kind, asRecord(status?.widgetData))
  if (!verdict) {
    return null
  }
  return 'problem' in verdict ? { ...verdict.problem, widget } : { rendered: verdict.rendered, widget }
}

/**
 * The preview's render, summarized. Only the widgets of THIS preview count (`names`, keyed by their
 * sandbox name): the cache also holds the page behind the drawer, and other previews of the shared
 * sandbox are someone else's.
 */
export const summarizePreviewRender = (
  states: readonly RenderedWidgetState[],
  names: PreviewWidgetNames,
  sandboxNamespace: string,
  timedOut = false,
): PreviewRenderSummary => {
  const problems: PreviewRenderProblem[] = []
  const rendered: string[] = []
  const seen = new Set<string>()
  for (const state of states) {
    const { name, namespace } = endpointParams(state.endpoint)
    const identity = name && namespace === sandboxNamespace ? names.get(name) : undefined
    // One line per widget, even when the same widget is mounted twice (drawer and composer).
    if (!identity || seen.has(name!)) {
      continue
    }
    seen.add(name!)
    const verdict = inspectRenderedWidget(state, identity, timedOut)
    if (verdict && 'category' in verdict) {
      problems.push(verdict)
    } else if (verdict) {
      rendered.push(`${verdict.widget}: ${verdict.rendered}`)
    }
  }
  return { problems: problems.slice(0, MAX_LINES), rendered: rendered.slice(0, MAX_LINES) }
}

/** One line per problem, as the model and the person read it. */
export const problemLine = ({ category, detail, widget }: PreviewRenderProblem): string =>
  `${widget}: ${category === 'loading' || category === 'error' ? '' : `${category} — `}${detail}`

/**
 * Wait for the preview to finish rendering, then hand back what the cache holds.
 *
 * "Finished" is: at least one of this preview's widgets is in the cache, none of them is loading,
 * every one settled AFTER `since` (the moment the preview was applied, so an answer cached from the
 * previous preview of the same names never counts), and that has held for `quietMs` — a container
 * renders its children only after it resolves, so the first quiet moment can come before the
 * children have even started. `timeoutMs` bounds the whole wait; past it, the caller reports what is
 * still loading as a problem rather than waiting forever.
 */
export const awaitSettledPreview = async (
  read: () => RenderedWidgetState[],
  isPreviewWidget: (state: RenderedWidgetState) => boolean,
  options: { since: number; timeoutMs?: number; quietMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<{ states: RenderedWidgetState[]; timedOut: boolean }> => {
  const { pollMs = 500, quietMs = 2500, since, timeoutMs = 45000 } = options
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const start = now()
  let quietSince: number | null = null
  for (;;) {
    const states = read()
    const mine = states.filter(isPreviewWidget)
    const busy = !mine.length || mine.some((state) => state.loadState === 'loading' || state.updatedAt < since)
    if (busy) {
      quietSince = null
    } else {
      quietSince ??= now()
      if (now() - quietSince >= quietMs) {
        return { states, timedOut: false }
      }
    }
    if (now() - start >= timeoutMs) {
      return { states, timedOut: true }
    }
    // eslint-disable-next-line no-await-in-loop -- a poll loop is sequential by nature
    await sleep(pollMs)
  }
}

/** Automatic follow-up turns one user request may produce, the report turn included. */
export const MAX_PREVIEW_FOLLOW_UPS = 3

export type PreviewFollowUp = { mode: 'fix' | 'report'; attempt: number; repeated: boolean }

/**
 * The bound on the loop, one per provider; `reset` on every real user turn.
 *
 * A preview with problems earns a follow-up turn while the budget lasts. The follow-up asks for a
 * FIX, except when it is the last one the budget allows or the problems are the same as the ones the
 * previous follow-up already asked about (no progress): then it asks Agentiko to stop, report and
 * ask the person. After that, nothing more fires until the person speaks.
 *
 * "The same problems" compares widget and category, not the free text: a RESTAction error carries a
 * trace id or a timestamp that differs on every call, and must not read as progress.
 */
export const createPreviewDataLoop = () => {
  let followUps = 0
  let lastFingerprint: string | null = null
  let stopped = false
  return {
    next(problems: readonly PreviewRenderProblem[]): PreviewFollowUp | null {
      if (!problems.length || stopped || followUps >= MAX_PREVIEW_FOLLOW_UPS) {
        return null
      }
      const fingerprint = problems.map(({ category, widget }) => `${widget}|${category}`).sort().join('\n')
      const repeated = fingerprint === lastFingerprint
      lastFingerprint = fingerprint
      followUps += 1
      const mode = repeated || followUps === MAX_PREVIEW_FOLLOW_UPS ? 'report' : 'fix'
      stopped = mode === 'report'
      return { attempt: followUps, mode, repeated }
    },
    reset() {
      followUps = 0
      lastFingerprint = null
      stopped = false
    },
  }
}

/**
 * The hidden follow-up turn. It carries the WHOLE problem, because the specialist that fixes it runs
 * in a fresh session per call and sees nothing but what Agentiko forwards.
 */
export const previewFollowUpPrompt = (summary: PreviewRenderSummary, step: PreviewFollowUp): string => {
  const lines = summary.problems.map((problem) => `- ${problemLine(problem)}`).join('\n')
  const fine = summary.rendered.length ? `\nRendered with data: ${summary.rendered.join('; ')}.` : ''
  if (step.mode === 'fix') {
    return [
      `The portal drove the live preview of the page and read what each widget rendered (automatic check ${step.attempt} of ${MAX_PREVIEW_FOLLOW_UPS}). It rendered with problems:`,
      lines + fine,
      'The same lines are in your page context under `previewRender`. The page is not done while any of them is listed.',
      'Send these exact lines to frontend-agent together with every CR of your last previewPage, unchanged, and ask it to fix exactly these problems. Then emit a fresh previewPage of the whole corrected set in this reply.',
      'If a problem is the cluster genuinely holding no such data, say so with the evidence instead of changing the page. Do not publish.',
    ].join('\n')
  }
  const why = step.repeated
    ? 'they are the same problems the previous check reported, so another automatic fix would not help'
    : `that was the last automatic check (${MAX_PREVIEW_FOLLOW_UPS} of ${MAX_PREVIEW_FOLLOW_UPS})`
  return [
    `The portal drove the live preview of the page again and it still renders with problems — ${why}:`,
    lines + fine,
    'Stop fixing automatically: do not delegate again and do not emit another previewPage in this reply.',
    'Tell the person, in plain words, which widgets are still wrong and what each one shows, and ask how they want to proceed. Do not call the page done.',
  ].join('\n')
}

/** The chip under the previewing turn: what the preview showed, in a few words. */
export const previewRenderChipLabel = (summary: PreviewRenderSummary): string => {
  if (summary.problems.length) {
    return `preview rendered with ${plural(summary.problems.length, 'problem')}: ${summary.problems.map(problemLine).join(' · ')}`
  }
  return summary.rendered.length ? `Preview rendered: ${summary.rendered.join(' · ')}` : 'Preview rendered'
}
