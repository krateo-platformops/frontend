/**
 * The page plan: the draft is the ordered CR set `previewPage` receives (root Flex, every child
 * widget, every new RESTAction), and the steps run in order, stopping at the first failure:
 *
 *   1. builder-lint   the portal's own page lint, imported (pageLint.ts): lintPageDrafts + the root
 *                     rule, plus the portal's secrets rule over every RESTAction (secrets.ts)
 *   2. references     every widget's refs and apiRef resolve to the draft, or to an object snowplow
 *                     reads raw as the caller
 *   3. jq-compile     every RESTAction filter and widgetDataTemplate expression, snowplow's engine
 *   4. live-dry-run   every object judged by the API server through snowplow /call/dry-run as the
 *                     caller, dryRun=All + Strict; "live verdict missing" and notChecked are red
 *   5. data           every draft RESTAction resolved by snowplow (/call/read) as the caller, nothing
 *                     stored; stage errors read back, Secret-shaped output dropped
 *   6. coverage       informational: what the API server accepted (runs once the dry-run has)
 *
 * The gate emulates nothing snowplow does and holds no RBAC beyond reading its own Builder: steps
 * 1–3 are static, steps 2 (for out-of-draft refs), 4 and 5 are snowplow's (docs/snowplow-contract.md).
 */
import { lintPageDrafts, pageRootProblem } from '@frontend/components/Autopilot/pageLint'

import type { BuilderSpec } from '../builder'
import { pluralOf, schemaFor } from '../catalog'
import { type Coverage, type ObjectVerdict, step, type StepResult } from '../envelope'
import type { BuilderPlan, GateContext, PlanResult } from '../plan'

import { dataStep } from './data'
import { rec, type Rec } from './drafts'
import { dryRunStep } from './dryRun'
import { jqCompileStep } from './jqCompile'
import { referencesStep } from './references'
import { draftSecretsProblems } from './secrets'
import { shapeStep } from './shape'

export const coverageOf = (verdicts: ObjectVerdict[]): Coverage => {
  const count = (wanted: ObjectVerdict['verdict']): number => verdicts.filter((entry) => entry.verdict === wanted).length
  const validated = count('validated')
  const rejected = count('rejected')
  const notChecked = count('notChecked')
  const summary = validated === verdicts.length
    ? `API server accepted all ${verdicts.length} objects`
    : `API server accepted ${validated} of ${verdicts.length} objects (${rejected} rejected, ${notChecked} not checked)`
  return { notChecked, objects: verdicts.length, rejected, summary, validated, verdicts }
}

const coverageStep = (coverage: Coverage): StepResult => step('coverage', [], [
  coverage.summary,
  ...coverage.verdicts.map((value) => `${value.object} → ${value.resource}: ${value.verdict}${value.detail ? ` (${value.detail})` : ''}`),
])

const builderLintStep = async (drafts: readonly Rec[]): Promise<StepResult> => {
  const problems = await lintPageDrafts(drafts, { pluralOf, schemaFor })
  const root = pageRootProblem(drafts)
  if (root) {
    problems.push(root)
  }
  // Gate rule, the portal's own (scripts/lint-ra-secrets.py): no RESTAction may read Secrets.
  problems.push(...draftSecretsProblems(drafts))
  return step('builder-lint', problems, [
    `${drafts.length} object(s) linted by the portal's own page lint (pageLint.ts) over this release's widget schemas`,
    'every RESTAction held to the portal\'s secrets rule (lint-ra-secrets.py, fetchablePath)',
  ])
}

export const pagePlan: BuilderPlan = {
  draftKind: 'page',
  input: 'the ordered array of CR objects previewPage receives: the page-<slug> root Flex, every child widget, every new RESTAction',
  lints: {
    // The Portal Builder's declared lint runs over the CHART the portal generates from this set at
    // publish (pageDraft.ts → lintHeldDraft(files, 'page')). The set itself is what previewPage
    // judges, so that is the lint step 1 runs; chart-lint runs again on the portal at publish.
    'chart-lint': 'the publish-time lint of the chart generated from this set; the set itself is judged by the previewPage lint (step 1)',
  },
  async run(files: readonly unknown[], _builder: BuilderSpec, ctx: GateContext): Promise<PlanResult> {
    const steps: StepResult[] = []
    const shapeProblems = files
      .map((doc, i) => (rec(doc) ? null : `widgets[${i}]: not a CR object (an object with kind, metadata, spec) — a page draft is ${this.input}`))
      .filter((problem): problem is string => problem !== null)
    if (files.length === 0) {
      shapeProblems.push(`the draft is empty — a page draft is ${this.input}`)
    }
    if (shapeProblems.length > 0) {
      steps.push(step('builder-lint', shapeProblems))
      return { coverage: null, steps }
    }
    const drafts = files as Rec[]

    for (const run of [builderLintStep, referencesStep, jqCompileStep] as const) {
      // eslint-disable-next-line no-await-in-loop -- steps are ordered and stop at the first failure
      const result = await run(drafts, ctx)
      steps.push(result)
      if (!result.ok) {
        return { coverage: null, steps }
      }
    }

    const dry = await dryRunStep(drafts, ctx)
    steps.push(dry.step)
    const coverage = ctx.live ? coverageOf(dry.verdicts) : null
    if (dry.step.ok) {
      const data = await dataStep(drafts, ctx)
      steps.push(data.step)
      // The shape step joins step 5's output to the expression that consumes it (frontend#473). It
      // runs even when the data step found problems: a RESTAction that resolved is judged, and one
      // that did not is reported as not judged, per widget, rather than silently skipped.
      steps.push(await shapeStep(drafts, data.outputs, ctx))
    }
    steps.push(coverage ? coverageStep(coverage) : step('coverage', [], ['DISABLED: offline run (--offline) — nothing was submitted to an API server']))
    return { coverage, steps }
  },
}
