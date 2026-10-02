/**
 * The `restdef-mapping` inspector (T8, frontend#412): the selected Kind, as its RestDefinition says.
 *
 *   - VERBS — each verb's operation, and whether the inference put it there (inferred) or a person did
 *     (confirmed). A verb two operations both look like is a CONFLICT, shown as a choice between them
 *     (or leaving the verb out) and never resolved for the person. What is not a verb is said, the
 *     ACTIONS (a sub-path of an item or of the collection) apart from the rest.
 *   - PATH IDS (round 2) — where each get/update/delete reads its id parameter from: status when the
 *     create returns it (the KOG baseline), spec when the person chooses it. An ambiguous one (keyId or
 *     id), or one segment named two ways, waits for a CONFIRM here — the lint holds Publish until then.
 *   - IDENTIFIERS — from the GET response (or one findby item, with no get), nested fields included;
 *     STATUS FIELDS — what the server assigns; EXCLUDED FROM SPEC — what status carries instead;
 *     COMPARE SCOPE. The served version, kind, group, identifiers and the lists are LOCKED once
 *     published (CEL-immutable: changing one means deleting every resource of the Kind) — marked.
 *   - FINDBY — an envelope with two arrays needs its itemsPath named (oasgen never guesses).
 *   - AUTH — the document's security schemes, generated or skipped and why; the credential is a Secret
 *     a <Kind>Configuration names, never a value in this chart; and which parameters — an api-version
 *     header on every verb, a findby's filter or page size — move to the Configuration instead of
 *     every resource's spec.
 *   - ADVANCED — findby and pagination, fieldMapping, async, and what each verb's body carries: read
 *     here, edited in the file.
 *   - What T7's validator says about the RestDefinition as it will be installed, and its notices.
 */
import { Alert, Button, Checkbox, Collapse, Popconfirm, Radio, Select, Space } from 'antd'

import { countNoun } from '../../utils/utils'
import styles from '../BlueprintComposer/BlueprintComposer.module.css'

import {
  askedOnCreateNotes,
  configurationCandidates,
  exclusionCandidates,
  heldItemsPath,
  heldVerb,
  pathIdBindings,
  pluralOf,
  SERVED_VERSION,
  type CompareScope,
  type ControllerKind,
  type ControllerModel,
} from './controllerChart'
import own from './ControllerComposer.module.css'
import { securitySchemeSupport, type OasOperation } from './oasImport'
import {
  envelopeArrays,
  requestBodySchema,
  schemaProperties,
  successResponseSchema,
  VERB_ORDER,
  type FieldCandidate,
  type RestAction,
} from './operationMapping'
import { operationsInGroup } from './paletteModel'
import { crdVersionName, publishedBeforePinning, servedAsText } from './servedVersion'
import type { ControllerRefusal } from './useControllerWorkbench'

const OMIT = '__omit__'

const LOCKED = 'Locked once published'

export type FieldList = 'identifiers' | 'additionalStatusFields' | 'excludedSpecFields'

interface InspectorProps {
  kind: ControllerKind | null
  /** What this Kind's last publish locked, when it was published — its immutable fields, as published. */
  locked: Record<string, unknown> | null
  model: ControllerModel
  refusal: ControllerRefusal | null
  onBindPathParam: (param: string, field: string) => void
  onClear: () => void
  onCompareScope: (scope: CompareScope | null) => void
  onDismissRefusal: () => void
  onOpenFile: (path: string | null) => void
  onRemove: () => void
  onSetItemsPath: (itemsPath: string | null) => void
  onSetVerb: (action: RestAction, choice: { method: string; path: string } | null) => void
  onToggleConfigurationField: (parameter: { name: string; in: string; actions: string[] }) => void
  onToggleField: (list: FieldList, field: string) => void
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

/** `example.io/v1alpha1`, and the vendor's version when the document came with another. */
const servedAs = (model: ControllerModel): string => {
  return servedAsText(model.group, model.servedVersion, model.sourceVersion)
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

/** Each path parameter a held verb binds to a CR field: where it is read from, and — when ambiguous — the confirm. */
const PathIds = ({ kind, onBindPathParam }: { kind: ControllerKind; onBindPathParam: InspectorProps['onBindPathParam'] }) => {
  const bindings = pathIdBindings(kind)
  if (!bindings.length) {
    return <p className={styles.fieldText}>No verb reads a path parameter from the resource: each one is a spec field of the same name.</p>
  }
  return (
    <div className={own.checkList}>
      {bindings.map((binding) => (
        <div data-binding={binding.param} key={binding.param}>
          <Space wrap>
            <span className={styles.mono}>{`{${binding.param}} →`}</span>
            <Select
              aria-label={`Where {${binding.param}} is read from`}
              className={styles.mono}
              onChange={(value: string) => onBindPathParam(binding.param, value)}
              options={binding.choices.map((choice) => ({ label: choice, value: choice }))}
              popupMatchSelectWidth={false}
              size='small'
              value={binding.field}
            />
            {binding.confirm ? <Button onClick={() => onBindPathParam(binding.param, binding.field)} size='small' type='primary'>Confirm</Button> : null}
          </Space>
          <span className={own.reason}>{binding.confirm ?? `${binding.reason} — ${binding.actions.join(', ')}`}</span>
        </div>
      ))}
    </div>
  )
}

/** The findby's envelope: two or more arrays and oasgen refuses to guess — the person names the collection. */
const FindbyItems = ({ kind, model, onSetItemsPath }: { kind: ControllerKind; model: ControllerModel; onSetItemsPath: InspectorProps['onSetItemsPath'] }) => {
  const findby = heldVerb(kind.restDefinition, 'findby')
  const doc = model.spec?.oas.doc
  const arrays = findby && doc ? envelopeArrays(doc, successResponseSchema(doc, findby.method, findby.path)) : []
  const held = heldItemsPath(kind.restDefinition)
  if (arrays.length < 2 && !held) { return null }
  return (
    <Section title='Findby items'>
      <span className={own.reason}>
        {`The findby response is an envelope with ${countNoun(arrays.length, 'array')} (${arrays.join(', ')}). oasgen does not guess which holds the collection — name it.`}
      </span>
      <Select
        aria-label='itemsPath'
        className={styles.mono}
        onChange={(value: string) => onSetItemsPath(value || null)}
        options={[...arrays.map((name) => ({ label: `.${name}`, value: `.${name}` })), { label: 'Not set', value: '' }]}
        placeholder='choose the collection'
        popupMatchSelectWidth={false}
        size='small'
        value={held ?? undefined}
      />
    </Section>
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
            `itemsPath: ${typeof findby.itemsPath === 'string' ? findby.itemsPath : 'not set'}`,
            `pagination: ${findby.pagination ? JSON.stringify(findby.pagination) : 'not set'}`,
          ] : []),
          key: 'findby',
          label: 'Findby and pagination',
        },
        {
          children: lines(verbs.flatMap((verb) => (Array.isArray(verb.fieldMapping)
            ? (verb.fieldMapping as Record<string, unknown>[]).map((entry) => `${String(verb.action)}: ${Object.entries(entry).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join(', ')}`)
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

const NO_CREDENTIALS = 'no security scheme in the spec is supported, so the generated Configuration has no credentials field'

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
            <div className={styles.derived}><span className={styles.derivedLabel}>Spec</span><span className={styles.derivedValue}>{oas ? `${oas.summary.title || 'untitled'} · OpenAPI ${oas.summary.version} · ${countNoun(oas.summary.operations, 'operation')}` : '—'}</span></div>
            <div className={styles.derived}><span className={styles.derivedLabel}>Served as</span><span className={styles.derivedValue}>{model.group ? servedAs(model) : '—'}</span></div>
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
  const excluded = stringList(resource.excludedSpecFields)
  const configured = (Array.isArray(resource.configurationFields) ? resource.configurationFields as Record<string, unknown>[] : [])
    .map((entry) => entry.fromOpenAPI as { name?: string; in?: string } | undefined)
  const schemes = model.spec ? securitySchemeSupport(model.spec.oas.doc) : []
  const parameters = configurationCandidates(model, kind)
  const errors = kind.validation?.errors ?? []
  // Each skipped scheme is said once, in Auth, with its reason; the one about all of them has its own alert.
  const unsupported = kind.validation?.warnings.some((line) => line === NO_CREDENTIALS) ?? false
  const notices = (kind.validation?.warnings ?? []).filter((line) => !line.startsWith('security scheme ') && line !== NO_CREDENTIALS)
  const compareScope = typeof resource.compareScope === 'string' ? resource.compareScope : undefined
  const mapping = kind.held ?? kind.inference
  const unmapped = kind.inference?.unmapped ?? []
  const actions = unmapped.filter((entry) => entry.category === 'action')
  const others = unmapped.filter((entry) => entry.category !== 'action')
  const statusFrom = mapping?.verbs.get || !mapping?.verbs.findby ? 'the GET response' : 'one findby item (there is no get)'
  const oas = model.spec?.oas

  return (
    <section aria-label='Inspector' className={styles.pane} tabIndex={-1}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Inspector</span>
        <Button onClick={props.onClear} size='small' type='link'>Clear</Button>
      </div>
      <div className={styles.section}>
        <span className={styles.eyebrow}>
          {`${model.group}/${model.servedVersion ? crdVersionName(model.servedVersion) : SERVED_VERSION} · ${pluralOf(kind.kind)}`}
          <span className={own.lockNote}>{`· Kind, group and version: ${LOCKED.toLowerCase()}`}</span>
        </span>
        <span className={`${styles.fieldValue} ${styles.mono}`}>{kind.kind}</span>
        {publishedBeforePinning(model.servedVersion)
          ? <span className={own.reason}>{`Served as ${servedAs(model)} — its manifests are written against that version, so it stays.`}</span>
          : null}
        {!publishedBeforePinning(model.servedVersion) && model.sourceVersion
          ? <span className={own.reason}>{`Served as ${SERVED_VERSION} whatever the vendor calls its release — the document says ${model.sourceVersion}.`}</span>
          : null}
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
          title={`${kind.kind} is published: its kind, group, served version, identifiers, configuration fields, status fields and excluded fields cannot change in place — a change to one is refused.`}
          type='info'
        />
      ) : null}
      {refusal ? <Alert closable onClose={props.onDismissRefusal} showIcon title={refusal.reason} type='error' /> : null}
      {errors.length ? (
        <Alert description={<ul>{errors.map((line) => <li key={line}>{line}</li>)}</ul>} showIcon title={`${kind.kind} would be rejected — ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}`} type='error' />
      ) : null}
      {unsupported ? <Alert showIcon title='The generated Configuration has no credentials field' type='warning' /> : null}
      {notices.length ? <Alert description={<ul>{notices.map((line) => <li key={line}>{line}</li>)}</ul>} showIcon title='Accepted, but it does not work the way it reads' type='warning' /> : null}

      <Section title='Verbs'>
        <table className={own.verbs}>
          <thead><tr><th>Verb</th><th>Operation</th><th>From</th></tr></thead>
          <tbody>
            {VERB_ORDER.map((action) => <VerbRow action={action} key={action} kind={kind} onSetVerb={props.onSetVerb} operations={operations} />)}
          </tbody>
        </table>
        {actions.length ? (
          <p className={styles.note}>{`Not a verb — an action: ${actions.map((entry) => entry.key).join('; ')}. A sub-path of an item or of the collection is never a lifecycle verb.`}</p>
        ) : null}
        {others.length ? (
          <p className={styles.note}>{`Not a verb: ${others.map((entry) => `${entry.key} (${entry.reason})`).join('; ')}.`}</p>
        ) : null}
      </Section>

      <Section title='Path ids'>
        <span className={own.reason}>Where each verb reads its id from — status when the create returns it, spec when the person chooses it.</span>
        <PathIds kind={kind} onBindPathParam={props.onBindPathParam} />
      </Section>

      <FindbyItems kind={kind} model={model} onSetItemsPath={props.onSetItemsPath} />

      <Section locked title='Identifiers'>
        <span className={own.reason}>{`From ${statusFrom} — how the controller finds the resource it made.`}</span>
        <div className={own.checkList}>
          {withHeld(mapping?.identifierCandidates ?? [], identifiers).map((candidate) => (
            <Checkbox checked={identifiers.includes(candidate.field)} key={candidate.field} onChange={() => props.onToggleField('identifiers', candidate.field)}>
              <span className={styles.mono}>{candidate.field}</span>
              <span className={own.reason}>{candidate.reason}</span>
            </Checkbox>
          ))}
        </div>
      </Section>

      <Section locked title='Status fields'>
        <div className={own.checkList}>
          {withHeld(mapping?.statusFieldCandidates ?? [], statusFields).map((candidate) => (
            <Checkbox checked={statusFields.includes(candidate.field)} key={candidate.field} onChange={() => props.onToggleField('additionalStatusFields', candidate.field)}>
              <span className={styles.mono}>{candidate.field}</span>
              <span className={own.reason}>{candidate.reason}</span>
            </Checkbox>
          ))}
          {!(mapping?.statusFieldCandidates.length || statusFields.length) ? <p className={styles.fieldText}>{`${statusFrom === 'the GET response' ? 'The GET response' : 'The findby item'} returns nothing the create body does not send.`}</p> : null}
        </div>
      </Section>

      <Section locked title='Excluded from spec'>
        <span className={own.reason}>What the person is not asked for — status carries it, or the API sets it.</span>
        <div className={own.checkList}>
          {withHeld(exclusionCandidates(kind, model), excluded).map((candidate) => (
            <Checkbox checked={excluded.includes(candidate.field)} key={candidate.field} onChange={() => props.onToggleField('excludedSpecFields', candidate.field)}>
              <span className={styles.mono}>{candidate.field}</span>
              <span className={own.reason}>{candidate.reason}</span>
            </Checkbox>
          ))}
          {!(exclusionCandidates(kind, model).length || excluded.length) ? <p className={styles.fieldText}>There is no create body to leave fields out of.</p> : null}
        </div>
        {askedOnCreateNotes(kind, !!props.locked).map((note) => <p className={styles.note} key={note}>{note}</p>)}
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
        {oas ? <span className={own.reason}>{`Decided by the document — ${oas.summary.title || 'untitled'}${model.sourceVersion ? ` ${model.sourceVersion}` : ''} — not assumed for the controller.`}</span> : null}
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
                <span className={own.reason}>
                  {`read from the Configuration for ${parameter.actions[0] === '*' ? 'every verb' : parameter.actions.join(', ')}, not from each ${kind.kind}${parameter.nonAuth ? '' : ' — the document\'s apiKey'}`}
                </span>
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
