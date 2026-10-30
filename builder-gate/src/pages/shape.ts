/**
 * Step 6, shape (frontend#473): does each widget's widgetDataTemplate RESOLVE to the shape its own
 * CRD requires?
 *
 * WHY THERE IS A SIXTH STEP. `krateo-blueprints/event-health` paired a RESTAction emitting rows as
 * OBJECTS with a Table feeding them straight to `dataSource` (`expression: ${ .sites }`), where the
 * CRD requires an array of arrays of cells. It was authored, previewed, published, released and
 * installed, and every gate passed — because at each of those moments the query returned nothing.
 * With zero items the expression yields `[]`: there is no `dataSource[0]`, so the API server has
 * nothing to validate, the live-dry-run step calls the CR `validated`, and the preview renders an
 * empty table that looks like a working one. The first time a row existed, the widget died.
 *
 * The earlier steps cannot see it, and it is worth saying why rather than adding a step beside them:
 * live-dry-run (step 4) judges the CR, whose `widgetDataTemplate` is a TEMPLATE — the API server
 * never sees what it resolves to. data (step 5) resolves each RESTAction and reports its output, but
 * nothing joins that output to the widget expression that consumes it. This step is that join.
 *
 * WHAT IT WILL NOT GUESS. The shape of a PASS-THROUGH expression's output is the shape of its
 * INPUT, so with an empty result it is carried entirely by the RESTAction's own filter and cannot be
 * recovered from the widget draft. Standing in a synthetic row would only re-measure the stand-in,
 * at any injection point. That case is reported `notChecked` — which this gate's contract already
 * treats as a failure (server.ts) — rather than passed or guessed. A CONSTRUCTOR is different: its
 * nesting is fixed by the expression and holds for any input, so one primed element makes it
 * observable, and only its nesting and required keys are judged (widgetShape.ts structureOnly).
 */
import { checkResolvedShape, itemSchemaConstrains, primeEmptyArrays, schemaAtPath } from '@frontend/components/Autopilot/widgetShape'

import { step, type StepResult } from '../envelope'
import type { GateContext } from '../plan'
import { isRestAction, kindOf, labelOf, rec, type Rec, str } from './drafts'

export const STEP_BUDGET_MS = 15_000

/**
 * The jq inside a `${ … }` wrapper, or null when the value is not an expression.
 *
 * The trim matters and is not cosmetic: a chart writing `expression: >` produces a folded block
 * with a TRAILING NEWLINE, and the portal's own resolver checks the wrapper AFTER trimming
 * (ui/src/utils/jq-expression.ts, portal#226 — where not trimming meant the expression's own source
 * text was sent as payload). A gate that judged untrimmed values would disagree with the runtime.
 */
export const jqBodyOf = (expression: string): string | null => {
  const trimmed = expression.trim()
  return trimmed.startsWith('${') && trimmed.endsWith('}') ? trimmed.slice(2, -1) : null
}

/** A widget's data templates, as `{ forPath, expression }` pairs with both fields present. */
const templatesOf = (cr: Rec): { forPath: string; expression: string }[] => {
  const raw = rec(cr.spec)?.widgetDataTemplate
  if (!Array.isArray(raw)) { return [] }
  return raw.flatMap((entry) => {
    const item = rec(entry)
    const forPath = str(item?.forPath)
    const expression = str(item?.expression)
    return forPath && expression ? [{ expression, forPath }] : []
  })
}

/**
 * Columns that name a cell NO row carries (frontend#541's author-time half).
 *
 * A Table's `columns[].valueKey` selects a cell by key, so a column whose key appears in no row
 * renders blank and EXPORTS blank — csv and pdf get an empty cell, labelled json gets the key with
 * `null`. snowplow confirmed that is never an error on their side, which is the right default: a
 * renamed cell degrades instead of failing the export. But it is silent, and the person who sees
 * the blank column is whoever downloaded the file, while the person who can fix it is whoever wrote
 * the page.
 *
 * Reported as a NOTE rather than a problem, deliberately. A column can be legitimately empty for
 * the data this query happens to return — three rows with no `description` is not evidence the
 * column is wrong. So this says what it saw and leaves the judgement to the author, which is the
 * difference between telling someone something and refusing their work over it.
 *
 * Only meaningful against rows that exist: with an empty result every column is unbacked and
 * nothing follows from it.
 */
const unbackedColumns = (widgetData: Rec, resolved: unknown): string[] => {
  const columns = widgetData.columns
  if (!Array.isArray(columns) || !Array.isArray(resolved) || resolved.length === 0) {
    return []
  }
  const present = new Set<string>()
  for (const row of resolved) {
    if (!Array.isArray(row)) { continue }
    for (const cell of row) {
      const key = str(rec(cell)?.valueKey)
      if (key) { present.add(key) }
    }
  }
  // Nothing addressable at all (not a cell-array shape) — say nothing rather than report every
  // column as unbacked.
  if (present.size === 0) { return [] }
  return columns.flatMap((column) => {
    const key = str(rec(column)?.valueKey)
    return key && !present.has(key) ? [key] : []
  })
}

export const shapeStep = async (drafts: readonly Rec[], outputs: Map<string, unknown>, ctx: GateContext): Promise<StepResult> => {
  if (!ctx.live) {
    // Every step that needs the cluster says DISABLED rather than reporting per-object silence.
    // This one needs it twice over: without step 5's outputs there is nothing to resolve against.
    return step('shape', [], ['DISABLED: offline run (--offline) — no RESTAction was resolved, so no expression was judged'])
  }
  const widgets = drafts.map((cr, index) => ({ cr, index })).filter(({ cr }) => !isRestAction(cr) && templatesOf(cr).length > 0)
  if (widgets.length === 0) {
    return step('shape', [], ['no widget in the draft fills a field from data — nothing to resolve'])
  }

  const problems: string[] = []
  const notes: string[] = []
  const deadline = Math.min(ctx.deadline, Date.now() + STEP_BUDGET_MS)

  for (const { cr, index } of widgets) {
    const label = labelOf(cr, index)
    const kind = kindOf(cr)
    const apiRefName = str(rec(rec(cr.spec)?.apiRef)?.name)

    for (const { forPath, expression } of templatesOf(cr)) {
      const at = `${label}: ${forPath}`
      if (Date.now() > deadline) {
        problems.push(`${at}: notChecked: the step's time budget ran out`)
        continue
      }
      if (!schemaAtPath(kind, forPath)) {
        // builder-lint already refuses an unknown kind; an undeclared path is its business too.
        notes.push(`${at}: not judged — ${kind} declares no such field in the widget registry`)
        continue
      }
      const body = jqBodyOf(expression)
      if (body === null) {
        problems.push(`${at}: the expression is not a \${ … } expression, so it would reach the widget as literal text: ${expression.slice(0, 120)}`)
        continue
      }
      if (!apiRefName) {
        notes.push(`${at}: not judged — the widget declares no spec.apiRef, so there is no data to resolve against`)
        continue
      }
      if (!outputs.has(apiRefName)) {
        // references.ts owns "the ref resolves"; step 5 owns "it ran". Either already said so.
        notes.push(`${at}: not judged — ${apiRefName} was not resolved in this call`)
        continue
      }

      const output = outputs.get(apiRefName)
      // eslint-disable-next-line no-await-in-loop -- one expression at a time, inside the budget
      const resolved = await ctx.jq.eval(body, output)
      if (!resolved.ok) {
        problems.push(`${at}: the expression failed against ${apiRefName}'s own output: ${resolved.error}`)
        continue
      }

      const empty = Array.isArray(resolved.value) && resolved.value.length === 0
      if (!empty) {
        const verdict = checkResolvedShape(kind, forPath, resolved.value)
        if (verdict.verdict === 'wrong') {
          problems.push(`${at}: resolved against ${apiRefName}'s live output, the API server would reject it — ${verdict.detail}`)
        } else if (verdict.verdict === 'unknowable') {
          notes.push(`${at}: ${verdict.detail}`)
        } else {
          notes.push(`${at}: resolved against ${apiRefName}'s live output and matches the CRD`)
          const unbacked = unbackedColumns(rec(rec(cr.spec)?.widgetData) ?? {}, resolved.value)
          if (unbacked.length > 0) {
            const one = unbacked.length === 1
            notes.push(`${at}: ${one ? 'column' : 'columns'} ${unbacked.map((key) => `"${key}"`).join(', ')} ${one ? 'names' : 'name'} a cell no row carries, so ${one ? 'it' : 'they'} will render blank and export blank (empty in csv/pdf, null in labelled json). Either ${apiRefName} no longer emits ${one ? 'that cell' : 'those cells'}, or ${one ? 'it is' : 'they are'} empty for this data — only you can tell which.`)
          }
        }
        continue
      }

      // Empty: the case every gate passed. A field whose items the CRD does not constrain has
      // nothing to withhold — every chart's `data` is a preserve-unknown object, so rows handed
      // straight through are correct there and saying otherwise would refuse working pages.
      if (!itemSchemaConstrains(kind, forPath)) {
        notes.push(`${at}: ${apiRefName} returned no items, so this was not exercised — but ${kind} lets any item stand at ${forPath}, so there is no shape it could get wrong`)
        continue
      }
      // Constrained items. Prime one element and resolve again: an expression that BUILDS its items
      // produces them whatever the input held, while one that passes its input through hands back
      // the primer. So this one evaluation tells the two apart without reading the jq as text.
      // eslint-disable-next-line no-await-in-loop -- as above
      const primed = await ctx.jq.eval(body, primeEmptyArrays(output))
      if (!primed.ok) {
        problems.push(`${at}: notChecked: ${apiRefName} returned no items, and the expression failed against a primed stand-in: ${primed.error}`)
        continue
      }
      const verdict = checkResolvedShape(kind, forPath, primed.value, { structureOnly: true })
      if (verdict.verdict !== 'wrong') {
        notes.push(`${at}: ${apiRefName} returned no items; the expression builds its own items, so it was judged against ONE STAND-IN (nesting and required keys only) and matches what ${kind} requires. Its values are unexercised.`)
        continue
      }
      // The expression did not build what the CRD requires, and there is no data to show what it
      // would have passed through. This is frontend#473's position exactly, and the honest verdict
      // is notChecked — which this gate's contract treats as a failure.
      problems.push(`${at}: notChecked: ${apiRefName} returned no items, and this expression does not build the items ${kind} requires at ${forPath} — it hands through whatever ${apiRefName}'s filter emits, so a row's shape cannot be known from this draft. Against one stand-in row the API server would answer: ${verdict.detail}. This is the frontend#473 shape: accepted while the query is empty, broken the first time a row exists. Build the items in the expression, or run the gate when the query returns at least one.`)
    }
  }

  return step('shape', problems, notes)
}
