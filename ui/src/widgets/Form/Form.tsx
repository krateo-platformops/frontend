import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button, Descriptions, Form as AntdForm, Result, Space, Spin } from 'antd'
import useApp from 'antd/es/app/useApp'
import dayjs from 'dayjs'
import type { JSONSchema4 } from 'json-schema'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { useAgentDraft } from '../../components/Autopilot/agentDraft'
import WidgetRenderer from '../../components/WidgetRenderer'
import { useHandleAction } from '../../hooks/useHandleActions'
import type { WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'
import { useDrawerContext } from '../Drawer/DrawerContext'

import styles from './Form.module.css'
import type { Form as WidgetType } from './Form.type'
import { SchemaForm } from './SchemaFields'
import { getDefaultsFromSchema, narrowAgentDraft } from './utils'

export type FormWidgetData = WidgetType['spec']['widgetData']

/**
 * Returns a shallow copy of a flat object where Dayjs values are converted to ISO
 * strings (form-control values like DatePicker are Dayjs; they must be serialized).
 */
export const convertDayjsToISOString = (values: Record<string, unknown>) => {
  const result: Record<string, unknown> = {}

  Object.entries(values).forEach(([key, value]) => {
    result[key] = dayjs.isDayjs(value) ? value.toISOString() : value
  })

  return result
}

interface FormExtraProps {
  buttonConfig?: FormWidgetData['buttonConfig']
  disabled?: boolean | undefined
  form?: string | undefined
  loading?: boolean
  // When set, a "Save draft" button is shown between Cancel and the primary; it is a
  // plain (htmlType='button') button so it does NOT trigger form validation — clicking
  // it persists the current field values as-is. Only wired for the inline (non-drawer)
  // render; the drawer omits it.
  onDraft?: (() => void | Promise<void>) | undefined
  // Disables ONLY the primary (submit) button while leaving Cancel/Reset usable — used by
  // `submitDisabledWhenPristine` so an unchanged form (e.g. a version picker still on the
  // current version) can't submit a no-op.
  submitDisabled?: boolean | undefined
  // Overrides the primary (submit) button label — used by review-before-submit so the
  // Configure step's button reads "Review →" while the final Review-step button keeps
  // the real create label.
  submitLabel?: string | undefined
}

// localStorage key prefix for client-side form drafts (replaces the former blueprint-drafts
// ConfigMap): a half-finished form is saved/resumed entirely in the browser, so NO
// frontend-entered field is ever persisted on the backend.
const DRAFT_STORAGE_PREFIX = 'K_draft__'

const FormExtra = ({ buttonConfig, disabled = false, form, loading, onDraft, submitDisabled = false, submitLabel }: FormExtraProps): React.ReactNode => {
  const navigate = useNavigate()
  // When `secondary.navigateTo` is set the secondary button is a Cancel that
  // navigates (SPA) instead of resetting the form.
  const secondaryNav = buttonConfig?.secondary?.navigateTo
  // Action bar: Save draft pinned LEFT, Cancel + primary grouped RIGHT (mockup `.actionbar`
  // split). With no draft action (e.g. the drawer render) the left slot is an empty spacer,
  // so the right group stays right-aligned — unchanged from the previous single-Space layout.
  return (
    <div className={styles.actionRow}>
      {onDraft
        ? (
          <Button
            disabled={disabled}
            htmlType='button'
            icon={buttonConfig?.draft?.icon ? <FontAwesomeIcon icon={buttonConfig?.draft?.icon as IconProp} /> : undefined}
            onClick={() => { void onDraft() }}
            type='default'
          >
            {buttonConfig?.draft?.label || 'Save draft'}
          </Button>
        )
        : <span />}
      <Space>
        <Button
          disabled={disabled}
          form={form}
          htmlType={secondaryNav ? 'button' : 'reset'}
          icon={buttonConfig?.secondary?.icon ? <FontAwesomeIcon icon={buttonConfig?.secondary?.icon as IconProp} /> : undefined}
          onClick={secondaryNav ? () => { void navigate(secondaryNav) } : undefined}
          type='default'
        >
          {buttonConfig?.secondary?.label || 'Reset'}
        </Button>
        <Button
          disabled={submitDisabled}
          form={form}
          htmlType='submit'
          icon={buttonConfig?.primary?.icon ? <FontAwesomeIcon icon={buttonConfig?.primary?.icon as IconProp} /> : undefined}
          loading={loading}
          type='primary'
        >
          {submitLabel ?? (buttonConfig?.primary?.label || 'Submit')}
        </Button>
      </Space>
    </div>
  )
}

/**
 * Read-only summary shown in the in-place Review step (`reviewBeforeSubmit`). Renders the
 * validated values that WILL create the resource as an antd `Descriptions`, labelled from
 * the schema (`title` → key), name+namespace first, with the per-user draft key and empty
 * values omitted. Object/array values are JSON-shown.
 */
/** Display a reviewed value: objects/arrays as JSON, booleans as Yes/No, else as text. */
const formatReviewValue = (value: unknown): string => {
  if (typeof value === 'object') { return JSON.stringify(value) }
  if (typeof value === 'boolean') { return value ? 'Yes' : 'No' }
  if (typeof value === 'number') { return String(value) }
  if (typeof value === 'string') { return value }
  return ''
}

/** Sort key: identity (name, namespace) first, everything else after. */
const reviewFieldOrder = (key: string): number => {
  if (key === 'name') { return 0 }
  if (key === 'namespace') { return 1 }
  return 2
}

const ReviewSummary = ({ schema, values }: { schema?: JSONSchema4; values: Record<string, unknown> }): React.ReactNode => {
  const items = Object.entries(values)
    .filter(([key]) => key !== '__owner')
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0))
    .sort(([keyA], [keyB]) => reviewFieldOrder(keyA) - reviewFieldOrder(keyB))
    .map(([key, value]) => {
      const node = schema?.properties?.[key]
      const label = (typeof node?.title === 'string' && node.title) || key
      return { children: formatReviewValue(value), key, label }
    })

  return (
    <Descriptions
      bordered
      column={1}
      items={items}
      size='small'
      title='Review — these values will create the composition'
    />
  )
}

/**
 * Composable Form: provides the antd Form context + submit, and renders its
 * child form-control widgets (Input/Select/Switch/…) which self-bind by
 * `Form.Item` name. There is no client-side schema generator — a CR that needs
 * to build fields from a source schema does so server-side via a jq expression
 * in `widgetDataTemplate` that populates `items`.
 *
 * When `reviewBeforeSubmit` is set (inline render only), the primary button first
 * validates and reveals an in-place read-only Review of the entered values; the form
 * stays mounted (hidden) so "Back to edit" keeps every value, and the final Review-step
 * button runs the same submit action. Default (flag off) is unchanged.
 */
const Form = ({ deniedRefIds, resourcesRefs, widget, widgetData }: WidgetProps<FormWidgetData>) => {
  const { actions, buttonConfig, disabled, draftActionId, initialValues, items, layout, propertiesToHide, reviewBeforeSubmit, schema, size, stringSchema, submitActionId, submitActionSelector, submitDisabledWhenPristine } = widgetData
  // Prefer `stringSchema` (the schema as a raw JSON STRING) when present: `JSON.parse`
  // preserves the object's key insertion order, so a server that hands us the blueprint's
  // values.schema.json verbatim (e.g. from the per-blueprint jsonschema ConfigMap, which
  // keeps authoring order) renders fields in that order — unlike the `schema` object sourced
  // from the CRD's openAPIV3Schema, whose properties map is serialized alphabetically. Falls
  // back to the `schema` object when stringSchema is absent or not valid JSON. Memoized so
  // the (potentially large) parse doesn't run on every controlled-form keystroke.
  const jsonSchema = useMemo<JSONSchema4 | undefined>(() => {
    if (typeof stringSchema === 'string' && stringSchema.trim() !== '') {
      try {
        return JSON.parse(stringSchema) as JSONSchema4
      } catch {
        // malformed string schema — fall back to the object schema below
      }
    }

    return schema as JSONSchema4 | undefined
  }, [schema, stringSchema])
  const { insideDrawer, setDrawerData } = useDrawerContext()
  const alreadySetDrawerData = useRef(false)

  const { notification } = useApp()
  const { handleAction, isActionLoading } = useHandleAction()

  // A controlled instance so the draft handler can read the live store (incl. values
  // seeded via initialValues but not rendered, e.g. the per-user draft key) — onFinish
  // only yields validated, registered fields.
  const [form] = AntdForm.useForm()

  // In-place Review state: the validated values captured on "Review →" (null = editing).
  const [reviewValues, setReviewValues] = useState<Record<string, unknown> | null>(null)
  const reviewing = !insideDrawer && !!reviewBeforeSubmit && reviewValues !== null

  // Autopilot AgentDraft (Phase 3 gated form-fill): values Autopilot proposes for the create form;
  // the user still reviews and presses Create. Applied imperatively below via setFieldsValue (NOT
  // via initialValues — see that effect for why). Empty/absent when Autopilot isn't driving.
  // `nonce` is bumped by the provider on each NEW draft — the apply effect keys off it so a
  // widget refetch (which recomputes `safeAgentDraft`'s identity) can't re-apply a stale draft.
  const { draft: agentDraft, nonce: draftNonce } = useAgentDraft()

  // Client-side draft persistence (NO backend): a half-finished form is saved to localStorage
  // under the per-form key the RA seeds as `__owner` (username__namespace__name) and resumed on
  // mount — replacing the former blueprint-drafts ConfigMap, so no frontend-entered field touches
  // the backend; the draft lives only in this browser.
  const draftOwner = typeof initialValues?.__owner === 'string' ? initialValues.__owner : undefined
  const draftStorageKey = draftOwner ? `${DRAFT_STORAGE_PREFIX}${draftOwner}` : undefined
  const savedDraft = useMemo<Record<string, unknown>>(() => {
    if (!draftStorageKey) { return {} }
    try {
      const raw = localStorage.getItem(draftStorageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }, [draftStorageKey])

  // Filter the Autopilot draft to the form's REAL field names (top-level schema properties). The model
  // is told to use exact field names, but an invented or "closest-match" key would otherwise be held in
  // the form store by setFieldsValue while the chip still claims "drafted the form" — a value landing
  // nowhere. Apply only keys that are actual fields, so the draft can't mis-fill or silently vanish.
  //
  // AND NEVER A HIDDEN FIELD. `propertiesToHide` removes a property from the rendered form
  // (SchemaForm `hide`), so a value the agent writes there is one the human cannot see, cannot
  // correct, and does not know it is approving when they press submit. The whole premise of
  // agent-fills-human-submits is that the human reviews what was filled; a field they were never
  // shown is outside that review by construction. Dropped silently rather than refused: the
  // model is not told which fields are hidden, so writing one is a mistake to absorb, not an
  // attack to report — and the remaining fields still fill correctly.
  const safeAgentDraft = useMemo<Record<string, unknown> | undefined>(
    () => narrowAgentDraft(agentDraft, jsonSchema?.properties, propertiesToHide),
    [agentDraft, jsonSchema, propertiesToHide],
  )

  // Effective initial values = schema defaults < explicit initialValues < the resumed localStorage
  // draft < the Autopilot draft — the SAME object handed to <AntdForm initialValues> below. Factored
  // out so the pristine check compares against exactly what the form was seeded with.
  const effectiveInitialValues = useMemo<Record<string, unknown>>(
    () => {
      const base = jsonSchema
        ? { ...getDefaultsFromSchema(jsonSchema), ...initialValues, ...savedDraft }
        : { ...(initialValues ?? {}), ...savedDraft }
      return safeAgentDraft ? { ...base, ...safeAgentDraft } : base
    },
    [jsonSchema, initialValues, savedDraft, safeAgentDraft],
  )

  // Apply an Autopilot draft IMPERATIVELY. Seeding it through `initialValues` (above) does NOT work
  // for blueprint forms: every schema field <SchemaForm> renders carries its own per-field
  // `initialValue` (the schema default), and antd lets a field's own initialValue WIN over the
  // form-level initialValues — so the draft only landed on fields WITHOUT a default (e.g. namespace)
  // and silently dropped name/region/cidr/…. setFieldsValue overrides per-field defaults AND avoids
  // a remount (so values the user already typed survive), so the Autopilot fills EVERY field it
  // drafted. Fires ONCE per new draft, keyed by the provider's `nonce` (bumped on each
  // prefillForm): `safeAgentDraft` alone is not a safe trigger because a widget refetch replaces
  // the schema identity and recomputes it — re-applying the SAME draft over values the user has
  // edited since (issue #33). The nonce guard keeps a genuinely-new draft applying (even over
  // dirty fields — the user asked Autopilot to fill the form) while refetches are inert.
  const appliedDraftNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!safeAgentDraft || Object.keys(safeAgentDraft).length === 0) {
      return
    }
    if (appliedDraftNonceRef.current === draftNonce) {
      return
    }
    appliedDraftNonceRef.current = draftNonce
    form.setFieldsValue(safeAgentDraft)
  }, [safeAgentDraft, draftNonce, form])

  // Refetch-vs-dirty-form reconciliation (issue #33). A live-refresh/event-driven refetch
  // replaces `widgetData` (schema + initialValues get NEW identities) WITHOUT remounting the
  // Form (WidgetRenderer keeps the element tree stable), and antd applies `initialValues` on
  // mount only — so by default a refetch changes nothing the user can see. This effect adds the
  // one desirable exception: while the form is fully PRISTINE (no field touched by the user),
  // re-seed the freshly-fetched initialValues so an idle form tracks server state. It re-seeds
  // via `setFields` with `touched: false` — NOT `setFieldsValue`, which marks changed fields
  // touched and would make the first server-side change freeze all future ones. The moment the
  // user has touched ANY field, refetched initialValues are never applied again: user input
  // wins, while fresh schema/options still flow in through the normal re-render.
  const lastSeededInitialsRef = useRef(effectiveInitialValues)
  useEffect(() => {
    if (lastSeededInitialsRef.current === effectiveInitialValues) {
      return
    }
    lastSeededInitialsRef.current = effectiveInitialValues
    if (form.isFieldsTouched()) {
      return
    }
    form.setFields(Object.entries(effectiveInitialValues).map(([name, value]) => ({ name, touched: false, value })))
  }, [effectiveInitialValues, form])

  // Live form values (re-renders on any field change). Used only to gate the submit button when
  // `submitDisabledWhenPristine` is set: disabled until at least one field differs from its initial
  // value — so e.g. a version picker still on the installed version can't submit a no-op update.
  // `[]` watches the whole store. The store is partial before fields settle, so DIRTY is defined as
  // "some field has a DEFINED value that differs from its initial" — an absent/undefined value is
  // treated as unchanged (still pristine), which keeps the button disabled until a real change.
  const watchedValues = AntdForm.useWatch([], form) as Record<string, unknown> | undefined
  const submitPristine = useMemo<boolean>(() => {
    if (!submitDisabledWhenPristine) { return false }
    const dirty = !!watchedValues && Object.keys(effectiveInitialValues).some((key) => {
      const current = watchedValues[key]
      return current !== undefined && JSON.stringify(current) !== JSON.stringify(effectiveInitialValues[key])
    })
    return !dirty
  }, [submitDisabledWhenPristine, watchedValues, effectiveInitialValues])

  /* https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button#form */
  const formId = useId()

  useEffect(() => {
    if (insideDrawer && !alreadySetDrawerData.current) {
      setDrawerData({ extra: <FormExtra buttonConfig={buttonConfig} form={formId} loading={isActionLoading} /> })
      alreadySetDrawerData.current = true
    }
  }, [buttonConfig, formId, insideDrawer, isActionLoading, setDrawerData])

  const allActions = Object.values(actions).flat()
  const action = allActions.find(({ id }) => id === submitActionId)

  // Field-conditional submit routing: when `submitActionSelector` is set, the effective submit
  // action is chosen at submit time from the value of the named field (e.g. a "target cluster"
  // Select where "local" posts the blueprint instance and a remote spoke posts a RemoteInstall).
  // Falls back to the selector's `default`, then the static `submitActionId`, then `action`.
  const resolveSubmitAction = (formValues: Record<string, unknown>) => {
    if (submitActionSelector?.field) {
      const rawValue = formValues?.[submitActionSelector.field]
      // The selector field is an enum Select — its value is a string. Non-string values have no
      // mapping and fall through to `default` / `submitActionId`.
      const key = typeof rawValue === 'string' ? rawValue : ''
      const id = submitActionSelector.map?.[key] ?? submitActionSelector.default ?? submitActionId
      const picked = allActions.find((candidate) => candidate.id === id)
      if (picked) { return picked }
    }
    return action
  }

  // "Save draft" — persist the current field values WITHOUT validation to localStorage (NO
  // backend). getFieldsValue(true) returns the entire form store (including values seeded via
  // initialValues that have no rendered field), unlike onFinish which only delivers validated
  // registered fields; we drop the `__owner` key (it IS the storage key, not a field) and write
  // the rest under it, so a half-finished form survives a reload entirely client-side. Offered
  // whenever the CR sets draftActionId (the button gate) and a draft key is present.
  const onDraft = (draftActionId && draftStorageKey)
    ? () => {
      const values = convertDayjsToISOString(form.getFieldsValue(true) as Record<string, unknown>)
      delete values.__owner
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(values))
        notification.success({ message: 'Draft saved', placement: 'bottomLeft' })
      } catch {
        notification.error({ message: 'Could not save draft — browser storage is full', placement: 'bottomLeft' })
      }
    }
    : undefined

  const onSubmit = async (formValues: Record<string, unknown>) => {
    const effectiveAction = resolveSubmitAction(formValues)

    if (!effectiveAction) {
      notification.error({
        description: `The widget definition does not include an action (ID: ${submitActionId})`,
        message: 'Error while executing the action',
        placement: 'bottomLeft',
      })

      return
    }

    if (effectiveAction.type !== 'rest') {
      notification.error({
        // P17: `type !== 'rest'` is a chart-authoring mistake, and the person looking at the form
        // cannot fix it. Tell them the form cannot submit and who can; the detail stays in the
        // console for whoever maintains the chart.
        description: 'This form is not configured to submit. Ask whoever maintains this page.',
        message: 'The form cannot be submitted',
        placement: 'bottomLeft',
      })

      return
    }

    if (effectiveAction.onEventNavigateTo) {
      setDrawerData({ extra: <FormExtra buttonConfig={buttonConfig} disabled form={formId} loading={isActionLoading} /> })
    }

    const values = convertDayjsToISOString(formValues)

    await handleAction(effectiveAction, resourcesRefs, values, widget, undefined, deniedRefIds)
  }

  // On a validated submit: with review-before-submit on and still editing, capture the
  // values and switch to the in-place Review step instead of submitting. Otherwise submit.
  const onFinish = (formValues: Record<string, unknown>) => {
    if (reviewBeforeSubmit && !insideDrawer && reviewValues === null) {
      setReviewValues(convertDayjsToISOString(formValues))

      return
    }

    void onSubmit(formValues)
  }

  if (!jsonSchema?.properties && !items?.length) {
    return (
      <div className={styles.message}>
        <Result
          status='error'
          subTitle={`The Form widget has nothing to render — provide a \`schema\` (schema-driven) or \`items\` (composable form-control widgets)`}
          title='Error while rendering widget'
        />
      </div>
    )
  }

  if (isActionLoading) {
    return (
      <div className={styles.loading}>
        <Spin indicator={<FontAwesomeIcon icon={['fas', 'spinner'] as IconProp} spin />} spinning />
      </div>
    )
  }

  // If the form is inside a Drawer, buttons are already rendered in the Drawer
  const shouldRenderButtonsInsideForm = !insideDrawer

  const reviewButtons = (
    <Space>
      <Button disabled={isActionLoading} htmlType='button' onClick={() => { setReviewValues(null) }} type='default'>
        {buttonConfig?.reviewBack?.label || '← Back to edit'}
      </Button>
      <Button
        htmlType='button'
        loading={isActionLoading}
        onClick={() => { if (reviewValues) { void onSubmit(reviewValues) } }}
        type='primary'
      >
        {buttonConfig?.primary?.label || 'Create'}
      </Button>
    </Space>
  )

  const editButtons = (
    <FormExtra
      buttonConfig={buttonConfig}
      form={formId}
      loading={isActionLoading}
      onDraft={onDraft}
      submitDisabled={submitPristine}
      submitLabel={reviewBeforeSubmit ? (buttonConfig?.review?.label || 'Review →') : undefined}
    />
  )

  let footer: React.ReactNode = null
  if (shouldRenderButtonsInsideForm) {
    footer = reviewing ? reviewButtons : editButtons
  }

  return (
    <div className={styles.form} data-inside-drawer={insideDrawer}>
      {/* Kept mounted (hidden in review) so "Back to edit" preserves every entered value. */}
      <div style={reviewing ? { display: 'none' } : undefined}>
        <AntdForm
          disabled={disabled}
          form={form}
          id={formId}
          initialValues={effectiveInitialValues}
          layout={layout}
          onFinish={(formValues) => { onFinish(formValues as Record<string, unknown>) }}
          size={size}
        >
          {jsonSchema?.properties
            ? <SchemaForm hide={propertiesToHide} schema={jsonSchema} />
            : items?.map(({ resourceRefId }, index) => {
              const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)
              return endpoint ? <WidgetRenderer key={`${formId}-${index}`} widgetEndpoint={endpoint} /> : null
            })}
        </AntdForm>
      </div>

      {reviewing && reviewValues ? <ReviewSummary schema={jsonSchema} values={reviewValues} /> : null}

      <div className={styles.extra}>{footer}</div>
    </div>
  )
}

export default Form
