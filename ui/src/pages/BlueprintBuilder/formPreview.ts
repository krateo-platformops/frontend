/**
 * Why the inspector cannot preview the create form, when it cannot. Pure.
 *
 * `buildFormPreviewModel` answers null for three different reasons — no schema, a schema that is
 * not JSON, a schema with no properties — and "no form" on its own reads as a bug. Each reason
 * says what to do: the first blocks publishing (the lint says so too), the second is a typo to fix,
 * the third is simply a chart nobody has placed a field in yet (mockup screen 3).
 */
import { VALUES_SCHEMA_PATH, buildFormPreviewModel } from '../../components/Autopilot/blueprintDraft'

/** Why the create form cannot be previewed, or null when it can. */
export const formPreviewGap = (schemaText: string | undefined): string | null => {
  if (schemaText === undefined) {
    return `There is no ${VALUES_SCHEMA_PATH}, so there is no create form — and the chart cannot be installed without one.`
  }
  if (buildFormPreviewModel(schemaText)) {
    return null
  }
  try {
    JSON.parse(schemaText)
  } catch {
    return `${VALUES_SCHEMA_PATH} is not valid JSON, so there is no form to preview.`
  }
  return `The form is empty because ${VALUES_SCHEMA_PATH} has no properties yet.`
}
