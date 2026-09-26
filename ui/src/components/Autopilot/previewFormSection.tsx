/**
 * FE-B1 — the "Create form preview" section of the Autopilot preview drawer: the
 * PRODUCTION schema renderer (widgets/Form SchemaForm — pure antd, zero network,
 * verified server-round-trip-free) mounted READ-ONLY over the previewed blueprint's
 * values.schema.json, spliced the way blueprint-formdef splices the published one
 * (synthetic name/namespace first, "(should be hidden)" titles hidden). The author
 * sees exactly the create form a consumer would get — before anything is published.
 * Interactive-looking but wired to NOTHING: the whole antd Form is disabled and has
 * no submit path.
 */
import { Form as AntdForm, Typography } from 'antd'

import { SchemaForm } from '../../widgets/Form/SchemaFields'

import { buildFormPreviewModel } from './blueprintDraft'

export const FORM_PREVIEW_TITLE = 'Create form preview'

/** The two honest fidelity deltas vs the production form (spec §3.2), stated up front. */
export const FORM_PREVIEW_CAPTION
  = 'Read-only preview generated client-side from the draft values.schema.json — nothing is submitted. In production, namespace is an RBAC-scoped select and defaults/enums come from this draft, not a live CRD.'

/** What a suppressed field is called in its line — the form's own label: its title, else its key. */
const fieldLabel = (schema: unknown, key: string): string => {
  const properties = (schema as { properties?: Record<string, { title?: unknown }> }).properties ?? {}
  const title = Object.prototype.hasOwnProperty.call(properties, key) ? properties[key]?.title : undefined
  return typeof title === 'string' && title.trim() ? title : key
}

/**
 * Renders the create-form preview from the RAW schema string carried by the drawer
 * payload. An unparseable or property-less schema renders nothing (the manifests
 * section still stands on its own) — never a crash.
 *
 * `suppressed`: top-level fields whose schema has a crdgen problem. The form cannot say what a
 * consumer would get for them — the chart would not register — so each is left out of the form and
 * named on a disabled line of its own instead of being drawn as if it were fine (mockup 10:87).
 */
export const PreviewFormSection = ({ formSchema, suppressed = [] }: { formSchema: string; suppressed?: string[] }) => {
  const model = buildFormPreviewModel(formSchema)
  if (!model) {
    return null
  }
  const withheld = suppressed.filter((key) => key !== 'name' && key !== 'namespace')
  return (
    <section data-testid='autopilot-form-preview'>
      <Typography.Title level={5}>{FORM_PREVIEW_TITLE}</Typography.Title>
      <Typography.Paragraph type='secondary'>{FORM_PREVIEW_CAPTION}</Typography.Paragraph>
      <AntdForm disabled layout='vertical'>
        <SchemaForm hide={[...model.hidden, ...withheld]} schema={model.schema} />
      </AntdForm>
      {withheld.map((key) => (
        <Typography.Paragraph aria-disabled='true' data-suppressed={key} disabled key={key}>
          {`${fieldLabel(model.schema, key)} — not rendered while the schema has a problem`}
        </Typography.Paragraph>
      ))}
    </section>
  )
}

export default PreviewFormSection
