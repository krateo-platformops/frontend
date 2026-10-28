/** Small, shared readers over a page draft set (the ordered CR objects previewPage receives). */
import { RESTACTION_KIND, RESTACTIONS_PLURAL } from '@frontend/components/Autopilot/pageLint'

import { pluralOf } from '../catalog'

export type Rec = Record<string, unknown>

export const rec = (value: unknown): Rec | null =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null)

export const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

export const kindOf = (cr: Rec): string => str(cr.kind) ?? ''
export const nameOf = (cr: Rec): string | null => str(rec(cr.metadata)?.name)

/** "widgets[2] (Flex/page-root)" — the prefix pageLint puts on every line, so all steps read alike. */
export const labelOf = (cr: Rec, index: number): string => `widgets[${index}] (${kindOf(cr) || '?'}/${nameOf(cr) ?? '?'})`

/** The resource plural a draft is created as: RESTAction's, a widget kind's, or null. */
export const pluralOfDraft = (cr: Rec): string | null =>
  (kindOf(cr) === RESTACTION_KIND ? RESTACTIONS_PLURAL : pluralOf(kindOf(cr)))

export const isRestAction = (cr: Rec): boolean => kindOf(cr) === RESTACTION_KIND

/**
 * plumbing's jqutil.MaybeQuery, ported: the jq inside the first `${ … }`, brace-balanced, trimmed.
 * `ok: false` means the string is a literal to snowplow. `unbalanced` flags a `${` that never
 * closes — snowplow renders that as literal text, which is never what an author meant.
 */
export const maybeQuery = (s: string): { query: string; ok: boolean; unbalanced: boolean } => {
  const at = s.indexOf('${')
  if (at === -1) {
    return { query: s, ok: false, unbalanced: false }
  }
  let depth = 1
  for (let end = at + 2; end < s.length; end += 1) {
    if (s[end] === '{') {
      depth += 1
    } else if (s[end] === '}') {
      depth -= 1
      if (depth === 0) {
        return { query: s.slice(at + 2, end).trim(), ok: true, unbalanced: false }
      }
    }
  }
  return { query: s, ok: false, unbalanced: true }
}
