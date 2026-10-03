/**
 * validate_draft(builder, files): resolve the Builder, pick the plan its draftKind names, refuse
 * any lint it declares that the plan does not know, run the plan, and fold the steps into the
 * envelope. Transport-free, so the MCP server, the offline CLI and the tests all call this.
 */
import type { BuilderLookup } from './builder'
import { type Envelope, step, type StepResult } from './envelope'
import { pagePlan } from './pages/plan'
import type { BuilderPlan, GateContext } from './plan'

/** Plans by Builder draftKind. A blueprint or controller plan registers here. */
export const PLANS: Record<string, BuilderPlan> = {
  [pagePlan.draftKind]: pagePlan,
}

/** Below the RemoteMCPServer's 120 s, so an overrun arrives as a readable envelope (CPA's GATE_TIMEOUT). */
export const GATE_TIMEOUT_MS = 100_000
/** Transport guards, as CPA's: a draft is never a bulk upload. */
export const MAX_FILES = 200
const DEFAULT_MAX_BYTES = 512 * 1024

/** Baked at build time (build.mjs): the frontend release this gate's lint is, and the snowplow its jq is. */
declare const __GATE_VERSION__: string
declare const __SNOWPLOW_REF__: string
export const GATE_VERSION = typeof __GATE_VERSION__ === 'string' ? __GATE_VERSION__ : 'dev'
export const SNOWPLOW_REF = typeof __SNOWPLOW_REF__ === 'string' ? __SNOWPLOW_REF__ : 'dev'

const envelopeOf = (steps: StepResult[], coverage: Envelope['coverage']): Envelope => {
  const failed = steps.find((s) => !s.ok)
  return { ok: !failed, failedStep: failed?.name ?? null, steps, coverage }
}

export const runGate = async (
  builderName: string,
  files: readonly unknown[],
  ctx: GateContext,
  lookupBuilder: (name: string) => Promise<BuilderLookup>,
): Promise<Envelope> => {
  const notes = [`gate ${GATE_VERSION} (frontend release: its lint and widget schemas), snowplow jq ${SNOWPLOW_REF}`]
  const lookup = await lookupBuilder(builderName)
  if (!lookup.ok) {
    return envelopeOf([step('builder', [lookup.problem], notes)], null)
  }
  const builder = lookup.builder
  notes.unshift(`Builder ${builder.name} (${builder.namespace}): draftKind ${builder.draftKind}, preview ${builder.previewMode ?? 'none'}`)
  const plan = PLANS[builder.draftKind]
  if (!plan) {
    return envelopeOf([step('builder', [
      `this gate has no plan for draftKind ${JSON.stringify(builder.draftKind)} (Builder ${builder.name}); it serves: ${Object.keys(PLANS).join(', ')}`,
    ], notes)], null)
  }
  const problems: string[] = []
  for (const lint of builder.lint) {
    if (plan.lints[lint]) {
      notes.push(`declared lint ${lint}: ${plan.lints[lint]}`)
    } else {
      problems.push(`the Builder declares lint ${JSON.stringify(lint)}, which this gate does not ship for ${builder.draftKind} drafts — refused, never skipped`)
    }
  }
  const maxBytes = builder.maxBytes ?? DEFAULT_MAX_BYTES
  const bytes = Buffer.byteLength(JSON.stringify(files))
  if (files.length > MAX_FILES) {
    problems.push(`the draft has ${files.length} entries; the gate takes at most ${MAX_FILES}`)
  }
  if (bytes > maxBytes) {
    problems.push(`the draft is ${bytes} bytes; Builder ${builder.name} holds at most ${maxBytes}`)
  }
  const builderStep = step('builder', problems, notes)
  if (!builderStep.ok) {
    return envelopeOf([builderStep], null)
  }

  let timer: NodeJS.Timeout | undefined
  const overrun = new Promise<Envelope>((resolve) => {
    timer = setTimeout(() => resolve(envelopeOf([builderStep, step('gate', [
      'the gate did not finish within its time budget — retry once; if it repeats, the API server or snowplow is slow, not the draft',
    ])], null)), Math.max(0, ctx.deadline - Date.now()))
  })
  try {
    return await Promise.race([plan.run(files, builder, ctx).then((r) => envelopeOf([builderStep, ...r.steps], r.coverage)), overrun])
  } finally {
    clearTimeout(timer)
  }
}
