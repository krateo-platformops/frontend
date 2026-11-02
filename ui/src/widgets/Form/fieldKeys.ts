/**
 * The keys `applyFieldConfig` writes on the schema nodes the form reads, from the lists in
 * `widgetData` (`autocomplete`, `dependencies`, `displayingDependencies`, `objectFields`,
 * `suggestions`). They are internal: an author never writes them, and any found in an incoming
 * schema is removed before the lists are applied, so the lists in `widgetData` — the ones the CRD
 * types and snowplow validates — are the only way a field gets this behaviour.
 */
export const OPTIONS_KEY = '__krateoOptions'
export const VISIBLE_WHEN_KEY = '__krateoVisibleWhen'
export const ROW_TITLE_KEY = '__krateoRowTitle'
export const SUGGESTIONS_KEY = '__krateoSuggestions'

export const INTERNAL_KEYS = [OPTIONS_KEY, VISIBLE_WHEN_KEY, ROW_TITLE_KEY, SUGGESTIONS_KEY]
