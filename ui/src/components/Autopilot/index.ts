/** Krateo Autopilot — frontend integration (Phase 1: read-only Q&A MVP). */
export { AutopilotProvider, useAutopilot } from './AutopilotProvider'
export { default as AutopilotRail, AutopilotShell } from './AutopilotRail'
export { default as AutopilotToggle } from './AutopilotToggle'
// UI-native KOG (Controller/API) builder — a plain-form "New RestDefinition" authoring path that
// reuses the SAME publish machinery + blast-radius confirm as the Autopilot publishRestDef flow.
export { default as KogBuilderForm, KogBuilderTrigger } from './KogBuilderForm'
export type { AutopilotMessage, PageContextEnvelope } from './types'
