/**
 * The keys `applyFieldConfig` writes on the schema nodes the form reads, from the lists in
 * `widgetData` (`autocomplete`, `checkboxes`, `dependencies`, `displayingDependencies`,
 * `fieldChecks`, `fieldHelp`, `objectFields`, `suggestions`, `textareas`, `validationMessages`).
 * They are internal: an author never writes them, and any found in an incoming schema is removed
 * before the lists are applied, so the lists in `widgetData` — the ones the CRD types and snowplow
 * validates — are the only way a field gets this behaviour.
 */
export const OPTIONS_KEY = '__krateoOptions'
export const VISIBLE_WHEN_KEY = '__krateoVisibleWhen'
export const ROW_TITLE_KEY = '__krateoRowTitle'
export const SUGGESTIONS_KEY = '__krateoSuggestions'
export const CHECKBOX_KEY = '__krateoCheckbox'
export const CHECK_KEY = '__krateoCheck'
export const HELP_KEY = '__krateoHelp'
export const TEXTAREA_KEY = '__krateoTextarea'
export const REQUIRED_MESSAGE_KEY = '__krateoRequiredMessage'

export const INTERNAL_KEYS = [OPTIONS_KEY, VISIBLE_WHEN_KEY, ROW_TITLE_KEY, SUGGESTIONS_KEY, CHECKBOX_KEY, CHECK_KEY, HELP_KEY, TEXTAREA_KEY, REQUIRED_MESSAGE_KEY]
