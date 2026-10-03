/**
 * Step 3, jq-compile: every expression snowplow will evaluate for this draft is compiled by
 * snowplow's own engine (jq.ts → jqcheck). Compile only: no data, no network.
 *
 *   - a RESTAction's spec.filter and each spec.api[].filter are raw jq (snowplow passes them to
 *     gojq as written — restactions.go, handler.go);
 *   - a widget's spec.widgetDataTemplate[].expression is a template: the jq inside `${ … }` is
 *     compiled, and an expression with no `${` is a literal (widgetdatatemplate/resolve.go).
 *
 * Why it matters beyond a parse: snowplow LOGS a per-api filter that fails and carries on with the
 * unfiltered response, so a broken per-api filter never surfaces as an error on the page.
 */
import { step, type StepResult } from '../envelope'
import type { JqExpr } from '../jq'
import type { GateContext } from '../plan'
import { isRestAction, labelOf, maybeQuery, rec, type Rec, str } from './drafts'

export const jqExpressionsOf = (drafts: readonly Rec[]): { exprs: JqExpr[]; problems: string[] } => {
  const exprs: JqExpr[] = []
  const problems: string[] = []
  for (const [index, cr] of drafts.entries()) {
    const label = labelOf(cr, index)
    const spec = rec(cr.spec)
    if (!spec) {
      continue
    }
    if (isRestAction(cr)) {
      const filter = str(spec.filter)
      if (filter) {
        exprs.push({ id: `${label}: spec.filter`, query: filter })
      }
      for (const [k, raw] of (Array.isArray(spec.api) ? spec.api : []).entries()) {
        const api = rec(raw) ?? {}
        const apiFilter = str(api.filter)
        if (apiFilter) {
          exprs.push({ id: `${label}: spec.api[${k}] (${str(api.name) ?? '?'}).filter`, query: apiFilter })
        }
      }
      continue
    }
    for (const [k, raw] of (Array.isArray(spec.widgetDataTemplate) ? spec.widgetDataTemplate : []).entries()) {
      const entry = rec(raw) ?? {}
      const expression = str(entry.expression)
      if (!expression) {
        continue
      }
      const where = `${label}: spec.widgetDataTemplate[${k}] (${str(entry.forPath) ?? '?'}).expression`
      const template = maybeQuery(expression)
      if (template.unbalanced) {
        problems.push(`${where}: "\${" is never closed — snowplow renders the whole expression as literal text`)
      } else if (template.ok) {
        exprs.push({ id: where, query: template.query })
      }
    }
  }
  return { exprs, problems }
}

export const jqCompileStep = async (drafts: readonly Rec[], ctx: GateContext): Promise<StepResult> => {
  const { exprs, problems } = jqExpressionsOf(drafts)
  try {
    for (const result of await ctx.jq.compile(exprs)) {
      if (!result.ok) {
        problems.push(`${result.id}: ${result.error ?? 'does not compile'}`)
      }
    }
  } catch (error) {
    problems.push(`notChecked: snowplow's jq engine did not run (${(error as Error).message})`)
  }
  return step('jq-compile', problems, [`${exprs.length} expression(s) compiled with snowplow's gojq fork and built-in modules`])
}
