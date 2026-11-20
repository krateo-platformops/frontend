/**
 * Portal tools: Agentiko calls the portal's verbs as tools of the agentiko-portal MCP server, whose tool
 * names ARE the verbs. The server only validates and acknowledges a call; the portal runs it. So a call
 * reaches the rail twice on the A2A stream: as a `tool_call` frame with the arguments, then as a
 * `tool_result` saying whether the server accepted them. Only an accepted call runs, so a call the model
 * corrected in the same turn runs once, in its corrected form.
 *
 * Whole objects travel as JSON text (`previewPage.widgets`, `applyResourceSet.ops[].payload`): Gemini fills a
 * free-form object argument unreliably, so the server takes a string and the rail parses it here.
 *
 * `propose_portal_action` is the older single-tool shape (its arguments are a whole proposal, verb
 * included). It runs unless its result is an error, as it always has.
 */
import type { PortalActionProposal, PortalTour } from './actionBridge'
import type { AgentikoFrame } from './types'

/** Tools whose call is a portal verb: the call becomes `{verb: <tool name>, ...arguments}`. */
export const PORTAL_VERB_TOOLS: ReadonlySet<string> = new Set([
  'navigate', 'setExtras', 'prefillForm', 'runAction', 'explainUpgradeImpact', 'describeResource',
  'patchField', 'applyResourceSet',
  'previewPage', 'composeMove', 'composeAdd', 'composeBind', 'publishPage',
  'previewBlueprint', 'chartPut', 'chartDelete', 'chartLink', 'publishBlueprint',
  'controllerStart', 'controllerPlace', 'controllerMapVerb', 'controllerSetIdentifiers',
  'controllerSetStatusFields', 'controllerRemoveKind', 'controllerBindId', 'controllerSetExcludedFields',
  'controllerSetItemsPath', 'controllerSetConfigurationFields', 'previewRestDef', 'publishRestDef',
])

const LEGACY_TOOL = 'propose_portal_action'
const SUGGEST_TOOL = 'suggestFollowups'
const TOUR_TOOL = 'startTour'
/** Answered by the server (a builder guide for the model); nothing for the portal to do. */
const GUIDE_TOOL = 'readBuilderGuide'

/** A portal tool: it drives the rail, so it is protocol rather than evidence. */
export const isPortalTool = (name: string): boolean =>
  PORTAL_VERB_TOOLS.has(name) || name === LEGACY_TOOL || name === SUGGEST_TOOL || name === TOUR_TOOL || name === GUIDE_TOOL

/** One portal tool call of a turn: `ok` is unset until its result arrives. */
export interface PortalToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  ok?: boolean
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * Fold one stream frame into the turn's portal calls. The final artifact can repeat a part the status
 * stream already carried, so a call whose id was seen is kept once. A frame with no id is never taken
 * for a repeat; its result settles the oldest unsettled call of that tool. Frames of other tools leave
 * the list unchanged.
 */
export const recordPortalFrame = (calls: readonly PortalToolCall[], frame: AgentikoFrame): PortalToolCall[] => {
  if ((frame.kind !== 'tool_call' && frame.kind !== 'tool_result') || !isPortalTool(frame.name)) {
    return [...calls]
  }
  if (frame.kind === 'tool_call') {
    if (frame.id !== undefined && calls.some((call) => call.id === frame.id)) {
      return [...calls]
    }
    return [...calls, { args: asRecord(frame.args) ?? {}, id: frame.id ?? `${frame.name}#${calls.length}`, name: frame.name }]
  }
  const index = calls.findIndex((call) => call.ok === undefined && (frame.id === undefined ? call.name === frame.name : call.id === frame.id))
  return index < 0 ? [...calls] : calls.map((call, at) => (at === index ? { ...call, ok: frame.isError !== true } : call))
}

/** What a turn's portal calls ask of the rail. */
export interface PortalToolTurn {
  /** In call order; the provider runs them through selectProposalsToRun like fence proposals. */
  proposals: PortalActionProposal[]
  suggestions: string[]
  tour?: PortalTour
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * A call's arguments with its JSON-text fields parsed into objects. Text that does not parse stays text, so
 * the verb refuses it as malformed; the server refuses such a call first, so it does not reach here.
 */
export const decodePortalArgs = (name: string, args: Record<string, unknown>): Record<string, unknown> => {
  if (name === 'previewPage' && typeof args.widgets === 'string') {
    const widgets = parseJson(args.widgets)
    if (Array.isArray(widgets)) {
      return { ...args, widgets }
    }
    return asRecord(widgets) ? { ...args, widgets: [widgets] } : args
  }
  if (name === 'applyResourceSet' && Array.isArray(args.ops)) {
    const ops = args.ops.map((op: unknown) => {
      const record = asRecord(op)
      if (!record || typeof record.payload !== 'string') {
        return op
      }
      const payload = parseJson(record.payload)
      return payload === undefined ? op : { ...record, payload }
    })
    return { ...args, ops }
  }
  return args
}

const runs = (call: PortalToolCall): boolean => (call.name === LEGACY_TOOL ? call.ok !== false : call.ok === true)

const tourOf = (args: Record<string, unknown>): PortalTour | undefined => {
  const steps = Array.isArray(args.steps)
    ? args.steps.filter((step): step is PortalTour['steps'][number] => {
      const record = asRecord(step)
      return Boolean(record && typeof record.anchor === 'string' && typeof record.title === 'string')
    })
    : []
  return steps.length ? { steps } : undefined
}

export const portalToolTurn = (calls: readonly PortalToolCall[]): PortalToolTurn => {
  const proposals: PortalActionProposal[] = []
  const suggestions: string[] = []
  let tour: PortalTour | undefined
  for (const call of calls.filter(runs)) {
    if (call.name === LEGACY_TOOL) {
      if (typeof call.args.verb === 'string') {
        proposals.push(call.args as unknown as PortalActionProposal)
      }
    } else if (call.name === SUGGEST_TOOL) {
      const list = Array.isArray(call.args.suggestions) ? call.args.suggestions : []
      suggestions.push(...list.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== ''))
    } else if (call.name === TOUR_TOOL) {
      tour = tour ?? tourOf(call.args)
    } else if (PORTAL_VERB_TOOLS.has(call.name)) {
      // The tool name is the verb, and it wins over any `verb` the arguments carry.
      proposals.push({ ...decodePortalArgs(call.name, call.args), verb: call.name })
    }
  }
  return { proposals, suggestions: [...new Set(suggestions)], ...(tour ? { tour } : {}) }
}
