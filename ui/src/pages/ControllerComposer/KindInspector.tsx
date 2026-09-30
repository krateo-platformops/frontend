/**
 * The `restdef-mapping` inspector (T8, frontend#412): the selected Kind, as its RestDefinition says.
 *
 *   - VERBS — each verb's operation, and whether the inference put it there (inferred) or a person did
 *     (confirmed). A verb two operations both look like is a CONFLICT, shown as a choice between them
 *     (or leaving the verb out) and never resolved for the person.
 *   - IDENTIFIERS — from the GET response (T7's candidates, with why each is one); STATUS FIELDS — what
 *     the server assigns; COMPARE SCOPE. The kind, the group and the identifiers are LOCKED once
 *     published (CEL-immutable: changing one means deleting every resource of the Kind) — marked.
 *   - AUTH — every security scheme of the document, generated or skipped and why; the credential is a
 *     Secret a <Kind>Configuration names, never a value in this chart; and which parameters move to
 *     the Configuration instead of every resource's spec.
 *   - ADVANCED — findby and pagination, fieldMapping, async, and what each verb's body carries: read
 *     here, edited in the file.
 *   - What T7's validator says about the RestDefinition as it will be installed.
 */
import { Alert, Button, Checkbox, Collapse, Popconfirm, Radio, Select, Space } from 'antd'

import styles from '../BlueprintComposer/BlueprintComposer.module.css'

import { heldVerb, pluralOf, type CompareScope, type ControllerKind, type ControllerModel } from './controllerChart'
import own from './ControllerComposer.module.css'
import { securitySchemeSupport, type OasOperation } from './oasImport'
import { requestBodySchema, schemaProperties, VERB_ORDER, type FieldCandidate, type RestAction } from './operationMapping'
import { operationsInGroup } from './paletteModel'
import type { ControllerRefusal } from './useControllerWorkbench'

const OMIT = '__omit__'

const LOCKED = 'Locked once published'

interface InspectorProps {
  kind: ControllerKind | null
  /** What this Kind's last publish locked, when it was published — its immutable fields, as published. */
  locked: Record<string, unknown> | null
  model: ControllerModel
  refusal: ControllerRefusal | null
  onClear: () => void
  onCompareScope: (scope: CompareScope | null) => void
  onDismissRefusal: () => void
  onOpenFile: (path: string | null) => void
  onRemove: () => void
  onSetVerb: (action: RestAction, choice: { method: string; path: string } | null) => void
  onToggleConfigurationField: (parameter: { name: string; in: string; actions: string[] }) => void
  onToggleField: (list: 'identifiers' | 'additionalStatusFields', field: string) => void
}

const resourceOf = (kind: ControllerKind): Record<string, unknown> =>
  ((kind.restDefinition.spec as { resource?: Record<string, unknown> } | undefined)?.resource) ?? {}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [])

/** The candidates, then anything held that is not one — a hand edit is shown, never dropped. */
const withHeld = (candidates: readonly FieldCandidate[], held: readonly string[]): FieldCandidate[] => [
  ...candidates,
  ...held.filter((field) => !candidates.some((candidate) => candidate.field === field)).map((field) => ({ field, reason: 'set in the file' })),
]

const Section = ({ children, locked, title }: { children: React.ReactNode; locked?: boolean; title: string }) => (
  <div className={styles.section}>
    <span className={styles.eyebrow}>
      {title}
      {locked ? <span className={own.lockNote}>{`· ${LOCKED}`}</span> : null}
    </span>
    {children}
  </div>
)

/** Header and query parameters of the Kind's verbs — what may move to its Configuration. */
const configurationParameters = (model: ControllerModel, kind: ControllerKind): { name: string; in: string; actions: string[] }[] => {
  const found = new Map<string, { name: string; in: string; actions: string[] }>()
  for (const action of VERB_ORDER) {
    const verb = heldVerb(kind.restDefinition, action)
    const operation = verb ? model.spec?.oas.operations.find((entry) => entry.method === verb.method && entry.path === verb.path) : undefined
    for (const parameter of operation?.parameters ?? []) {
      if (parameter.in !== 'header' && parameter.in !== 'query') { continue }
      const key = `${parameter.in}:${parameter.name}`
      const entry = found.get(key) ?? { actions: [], in: parameter.in, name: parameter.name }
      entry.actions.push(action)
      found.set(key, entry)
    }
  }
  return [...found.values()]
}

const VerbRow = ({ action, kind, onSetVerb, operations }: {
  action: RestAction
  kind: ControllerKind
  onSetVerb: InspectorProps['onSetVerb']
  operations: OasOperation[]
}) => {
  const held = heldVerb(kind.restDefinition, action)
  const conflict = kind.conflicts.find((entry) => entry.action === action)
  const inferred = kind.inference?.verbs[action]
  const omitted = kind.omitted.includes(action)
  const choose = (value: string) => {
    if (value === OMIT) {
      onSetVerb(action, null)
      return
    }
    const [method, ...rest] = value.split(' ')
    onSetVerb(action, { method, path: rest.join(' ') })
  }
  const selectedWhenUnheld = omitted ? OMIT : undefined
  let status = '—'
  if (conflict) {
    status = 'conflict — choose'
  } else if (held) {
    status = inferred && inferred.method === held.method && inferred.path === held.path ? 'inferred' : 'confirmed'
  } else if (omitted) {
    status = 'left out'
  }
  return (
    <tr data-verb={action}>
      <td className={own.verbAction}>{action}</td>
      <td>
        {conflict ? (
          <Radio.Group aria-label={`Which operation is ${action}`} onChange={(event) => choose(String(event.target.value))} value={null}>
            <span className={own.choices}>
              {conflict.candidates.map((candidate) => (
                <Radio key={`${candidate.method} ${candidate.path}`} value={`${candidate.method} ${candidate.path}`}>
                  <span className={styles.mono}>{`${candidate.method} ${candidate.path}`}</span>
                </Radio>
              ))}
              <Radio value={OMIT}>{`Leave ${action} out`}</Radio>
            </span>
          </Radio.Group>
        ) : (
          <Select
            aria-label={`Operation for ${action}`}
            className={styles.mono}
            onChange={choose}
            options={[
              ...operations.map((operation) => ({ label: operation.key, value: operation.key })),
              { label: `Leave ${action} out`, value: OMIT },
            ]}
            placeholder='not mapped'
            popupMatchSelectWidth={false}
            size='small'
            value={held ? `${held.method} ${held.path}` : selectedWhenUnheld}
          />
        )}
      </td>
      <td><span className={own.reason}>{status}</span></td>
    </tr>
  )
}

const Advanced = ({ kind, model }: { kind: ControllerKind; model: ControllerModel }) => {
  const resource = resourceOf(kind)
  const verbs = Array.isArray(resource.verbsDescription) ? (resource.verbsDescription as Record<string, unknown>[]) : []
  const findby = verbs.find((verb) => verb.action === 'findby')
  const lines = (entries: string[]) => (entries.length ? <ul className={styles.plainList}>{entries.map((line) => <li key={line}>{line}</li>)}</ul> : <p className={styles.fieldText}>Not set.</p>)
  const bodyFields = (action: RestAction): string[] => {
    const verb = heldVerb(kind.restDefinition, action)
    const doc = model.spec?.oas.doc
    return verb && doc ? Object.keys(schemaProperties(doc, requestBodySchema(doc, verb.method, verb.path))) : []
  }
  return (
    <Collapse
      ghost
      items={[
        {
          children: lines(findby ? [
            `identifiersMatchPolicy: ${typeof findby.identifiersMatchPolicy === 'string' ? findby.identifiersMatchPolicy : 'not set (AND)'}`,
            `pagination: ${findby.pagination ? JSON.stringify(findby.pagination) : 'not set'}`,
          ] : []),
          key: 'findby',
          label: 'Findby and pagination',
        },
        {
          children: lines(verbs.flatMap((verb) => (Array.isArray(verb.fieldMapping)
            ? (verb.fieldMapping as Record<string, unknown>[]).map((entry) => `${String(verb.action)}: ${Object.entries(entry).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`)
            : []))),
          key: 'fieldMapping',
          label: 'Field mapping',
        },
        {
          children: lines(verbs.filter((verb) => verb.async).map((verb) => `${String(verb.action)}: ${JSON.stringify(verb.async)}`)),
          key: 'async',
          label: 'Async',
        },
        {
          children: lines((['create', 'update'] as const).flatMap((action) => {
            const fields = bodyFields(action)
            return fields.length ? [`${action}: ${fields.join(', ')}`] : []
          })),
          key: 'spec',
          label: 'Spec per verb',
        },
      ]}
      size='small'
    />
  )
}

export const KindInspector = (props: InspectorProps) => {
  const { kind, model, refusal } = props
  if (!kind) {
    const oas = model.spec?.oas
    return (
      <section aria-label='Inspector' className={styles.pane} tabIndex={-1}>
        <div className={styles.paneHead}><span className={styles.paneTitle}>Inspector</span></div>
        <div className={styles.section}>
          <p className={styles.fieldText}>Select a Kind on Resources to map its verbs, identifiers and auth.</p>
          <div className={styles.derivedList}>
            <div className={styles.derived}><span className={styles.derivedLabel}>Spec</span><span className={styles.derivedValue}>{oas ? `${oas.summary.title || 'untitled'} · OpenAPI ${oas.summary.version} · ${oas.summary.operations} operations` : '—'}</span></div>
            <div className={styles.derived}><span className={styles.derivedLabel}>Served as</span><span className={styles.derivedValue}>{model.group ? `${model.group}/v1alpha1` : '—'}</span></div>
            <div className={styles.derived}><span className={styles.derivedLabel}>Calls</span><span className={styles.derivedValue}>{model.baseUrl || '—'}</span></div>
          </div>
        </div>
      </section>
    )
  }
  const resource = resourceOf(kind)
  const operations = model.spec ? operationsInGroup(model.spec.oas.operations, kind.group) : []
  const identifiers = stringList(resource.identifiers)
  const statusFields = stringList(resource.additionalStatusFields)
  const configured = (Array.isArray(resource.configurationFields) ? resource.configurationFields as Record<string, unknown>[] : [])
    .map((entry) => entry.fromOpenAPI as { name?: string; in?: string } | undefined)
  const schemes = model.spec ? securitySchemeSupport(model.spec.oas.doc) : []
  const parameters = configurationParameters(model, kind)
  const errors = kind.validation?.errors ?? []
  // Each skipped scheme is said once, in Auth, with its reason; what is left is the one about all of them.
  const warnings = (kind.validation?.warnings ?? []).filter((line) => !line.startsWith('security scheme '))
  const compareScope = typeof resource.compareScope === 'string' ? resource.compareScope : undefined

  return (
    <section aria-label='Inspector' className={styles.pane} tabIndex={-1}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Inspector</span>
        <Button onClick={props.onClear} size='small' type='link'>Clear</Button>
      </div>
      <div className={styles.section}>
        <span className={styles.eyebrow}>
          {`${model.group}/v1alpha1 · ${pluralOf(kind.kind)}`}
          <span className={own.lockNote}>{`· Kind and group: ${LOCKED.toLowerCase()}`}</span>
        </span>
        <span className={`${styles.fieldValue} ${styles.mono}`}>{kind.kind}</span>
        <Space wrap>
          <Button onClick={() => props.onOpenFile(kind.path)} size='small'>Open file</Button>
          <Popconfirm cancelText='Keep it' okText='Remove' onConfirm={props.onRemove} title={`Remove ${kind.kind}? Its RestDefinition leaves the chart.`}>
            <Button danger size='small'>Remove Kind</Button>
          </Popconfirm>
        </Space>
      </div>
      {props.locked ? (
        <Alert
          showIcon
          title={`${kind.kind} is published: its kind, group, identifiers, configuration fields and status fields cannot change in place — a change to one is refused.`}
          type='info'
        />
      ) : null}
      {refusal ? <Alert closable onClose={props.onDismissRefusal} showIcon title={refusal.reason} type='error' /> : null}
      {errors.length ? (
        <Alert description={<ul>{errors.map((line) => <li key={line}>{line}</li>)}</ul>} showIcon title={`${kind.kind} would be rejected — ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}`} type='error' />
      ) : null}
      {warnings.length ? <Alert description={<ul>{warnings.map((line) => <li key={line}>{line}</li>)}</ul>} showIcon title='The generated Configuration has no credentials field' type='warning' /> : null}

      <Section title='Verbs'>
        <table className={own.verbs}>
          <thead><tr><th>Verb</th><th>Operation</th><th>From</th></tr></thead>
          <tbody>
            {VERB_ORDER.map((action) => <VerbRow action={action} key={action} kind={kind} onSetVerb={props.onSetVerb} operations={operations} />)}
          </tbody>
        </table>
        {kind.inference?.unmapped.length ? (
          <p className={styles.note}>{`Not a verb: ${kind.inference.unmapped.map((entry) => `${entry.key} (${entry.reason})`).join('; ')}.`}</p>
        ) : null}
      </Section>

      <Section locked title='Identifiers'>
        <span className={own.reason}>From the GET response — how the controller finds the resource it made.</span>
        <div className={own.checkList}>
          {withHeld(kind.inference?.identifierCandidates ?? [], identifiers).map((candidate) => (
            <Checkbox checked={identifiers.includes(candidate.field)} key={candidate.field} onChange={() => props.onToggleField('identifiers', candidate.field)}>
              <span className={styles.mono}>{candidate.field}</span>
              <span className={own.reason}>{candidate.reason}</span>
            </Checkbox>
          ))}
        </div>
      </Section>

      <Section locked title='Status fields'>
        <div className={own.checkList}>
          {withHeld(kind.inference?.statusFieldCandidates ?? [], statusFields).map((candidate) => (
            <Checkbox checked={statusFields.includes(candidate.field)} key={candidate.field} onChange={() => props.onToggleField('additionalStatusFields', candidate.field)}>
              <span className={styles.mono}>{candidate.field}</span>
              <span className={own.reason}>{candidate.reason}</span>
            </Checkbox>
          ))}
          {!(kind.inference?.statusFieldCandidates.length || statusFields.length) ? <p className={styles.fieldText}>The GET response returns nothing the create body does not send.</p> : null}
        </div>
      </Section>

      <Section title='Compare scope'>
        <Select
          aria-label='Compare scope'
          onChange={(value: string) => props.onCompareScope(value === 'unset' ? null : value as CompareScope)}
          options={[
            { label: 'Not set — the controller default', value: 'unset' },
            { label: 'updatable — what an update can send', value: 'updatable' },
            { label: 'identifiersAndStatus', value: 'identifiersAndStatus' },
            { label: 'fullSpec — the whole spec', value: 'fullSpec' },
          ]}
          size='small'
          value={compareScope ?? 'unset'}
        />
      </Section>

      <Section title='Auth'>
        {schemes.length ? (
          <ul className={styles.plainList}>
            {schemes.map((scheme) => (
              <li data-scheme={scheme.name} key={scheme.name}>
                <span className={styles.mono}>{scheme.name}</span>
                {` (${scheme.type}) — `}
                {scheme.supported ? `used: the ${kind.kind}Configuration carries authentication.${scheme.authKey}` : `skipped: ${scheme.reason}`}
              </li>
            ))}
          </ul>
        ) : <p className={styles.fieldText}>The document declares no security scheme: the controller sends no credential.</p>}
        {schemes.some((scheme) => scheme.supported) ? (
          <p className={styles.note}>{`The credential is never held in this chart. A ${kind.kind}Configuration you create names the Secret it is read from (a secretRef — tokenRef, or usernameRef and passwordRef), and each ${kind.kind} points at it.`}</p>
        ) : null}
        <span className={styles.eyebrow}>Configuration fields</span>
        {parameters.length ? (
          <div className={own.checkList}>
            {parameters.map((parameter) => (
              <Checkbox
                checked={configured.some((entry) => entry?.name === parameter.name && entry?.in === parameter.in)}
                key={`${parameter.in}:${parameter.name}`}
                onChange={() => props.onToggleConfigurationField(parameter)}
              >
                <span className={styles.mono}>{`${parameter.name} (${parameter.in})`}</span>
                <span className={own.reason}>{`read from the Configuration for ${parameter.actions.join(', ')}, not from each ${kind.kind}`}</span>
              </Checkbox>
            ))}
          </div>
        ) : <p className={styles.fieldText}>No header or query parameter on this Kind&apos;s verbs.</p>}
      </Section>

      <Section title='Advanced'>
        <Advanced kind={kind} model={model} />
        <Button onClick={() => props.onOpenFile(kind.path)} size='small' type='link'>Edit in the RestDefinition file</Button>
      </Section>
    </section>
  )
}

export default KindInspector
