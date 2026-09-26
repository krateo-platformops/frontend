/**
 * The Inspector — mockup screens 3, 5 and 6: the selected resource, what it waits for and when it is
 * ready — each editable through the same kernel an edge drawn on the canvas goes through (planEdge) —
 * and below it the create form this chart would generate.
 *
 * WHAT IT WAITS FOR (5.4). Each Depends-on row says what it waits for and carries its own "Wait for
 * readiness" switch and a remove button; "Add dependency" lists every other node, the ones an edge
 * may not reach disabled with the reason — the keyboard's and the touch screen's route to the same
 * pending edge a drag makes. Every change is one batch of the descriptor and the templates it re-gates.
 *
 * WHEN IT IS READY — its own `readyWhen`, picked from what its CRD declares (readinessOptions), or its
 * class default — which re-gates everything that waits for it to be ready. A custom resource has no
 * default, and the panel says so rather than leaving a blank that reads as "fine".
 *
 * "One per item of" is editable on a node the palette placed: its template is still the shape placing
 * wrote, so ranging it is a kernel's job, not a hand edit (planPlace's setForEach). "Remove from chart"
 * (D19) takes the node, its template and every edge onto it, behind a confirm.
 *
 * A TEMPLATE THE CHART DOES NOT HOLD IS SAID, not linked. A resource added by editing the
 * architecture file has no template until someone writes one, and a link to a file that is not there
 * opened nothing, silently. The path is shown as text with what that means.
 *
 * JUST PLACED, it says what placing did: the chart changed, so Publish is off until Preview renders
 * it again — and how many files the chart now has, with no cap to measure them against (#367).
 *
 * THE FORM is `PreviewFormSection` — the drawer's, over the same values.schema.json — so a consumer's
 * create form is previewed one way everywhere, with any field whose schema has a crdgen problem left
 * out and named. "Open form editor" opens it out (screen 10). When there is nothing to preview, the
 * reason is named.
 */
import { Button, Input, Popconfirm, Select, Switch } from 'antd'
import { useEffect, useId, useState } from 'react'

import { PreviewFormSection } from '../../components/Autopilot/previewFormSection'

import { levelOf, type ResourceNode } from './architecture'
import { apiGroup, counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import { formPreviewGap } from './formPreview'
import type { ReadinessChoices } from './readinessOptions'
import { defaultReadiness } from './readyWhen'
import { formSuppressions } from './schemaEdit'
import { MISSING_READINESS } from './stepperModel'
import { PLACED_MARKER } from './templateGen'

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className={styles.field}>
    <span className={styles.eyebrow}>{label}</span>
    {children}
  </div>
)

const readiness = (node: ResourceNode): { label: string; note?: string; kstatus?: boolean } => {
  if (node.readyWhen) {
    return { label: 'Ready when' }
  }
  if (defaultReadiness(node)) {
    // A native kind the palette knows is ready by its OWN kstatus meaning — "available", "bound" —
    // and that is what the gate waits for.
    return { kstatus: node.class === 'native', label: 'Ready when · default for this class' }
  }
  const note = node.class === 'custom'
    ? 'A custom resource has no default, so nothing can wait on its readiness until one is declared.'
    : `${node.kind} has no readiness the composer knows, so nothing can wait on it until one is declared.`
  return { label: 'Ready when', note }
}

/** What the node's editing asks of the composer — each answers null when written, else why not. */
export interface NodeEditing {
  /** Where an edge out of this node may go, and why not elsewhere. */
  targets: { legal: string[]; refused: Record<string, string> }
  /** Every node id, in the descriptor's order. */
  order: string[]
  onAddDependency: (to: string) => void
  onSetEdgeReady: (to: string, ready: boolean) => string | null
  onRemoveEdge: (to: string) => string | null
  /** What the node's own Ready when can be (readinessOptions). */
  readyWhen: ReadinessChoices
  onSetReadyWhen: (readyWhen: string | null) => string | null
  onRemoveNode: () => string | null
}

const DependsOn = ({ editing, node, onRefusal }: { editing: NodeEditing; node: ResourceNode; onRefusal: (reason: string | null) => void }) => {
  // Every other node, in the descriptor's order — the ones an edge may not reach disabled, with why.
  const listed = new Set([...editing.targets.legal, ...Object.keys(editing.targets.refused)])
  const others = editing.order.filter((id) => listed.has(id))
  return (
    <Field label='Depends on'>
      {node.dependsOn?.length ? (
        <ul className={styles.plainList}>
          {node.dependsOn.map((dep) => (
            <li className={styles.dependsRow} key={dep.ref}>
              <span className={styles.dependsText}>
                <span className={styles.fieldValue}>{dep.ref}</span>
                <span className={styles.fieldText}>
                  {[
                    dep.ready ? ' — waits until it is ready' : ' — waits until it exists',
                    dep.all ? ', every instance' : '',
                    dep.when ? `, only when ${dep.when} is set` : '',
                  ].join('')}
                </span>
              </span>
              <Switch
                aria-label={`Wait for ${dep.ref} to be ready`}
                checked={!!dep.ready}
                disabled={!!node.lifecycle}
                onChange={(ready) => onRefusal(editing.onSetEdgeReady(dep.ref, ready))}
                size='small'
              />
              <Button aria-label={`Remove the dependency on ${dep.ref}`} onClick={() => onRefusal(editing.onRemoveEdge(dep.ref))} size='small' type='text'>✕</Button>
            </li>
          ))}
        </ul>
      ) : <span className={styles.fieldText}>nothing — it does not wait for anything</span>}
      {others.length && !node.lifecycle ? (
        <Select
          aria-label='Add dependency'
          className={styles.addDependency}
          onChange={(to: string) => editing.onAddDependency(to)}
          optionLabelProp='value'
          options={others.map((id) => ({
            disabled: !editing.targets.legal.includes(id),
            label: (
              <span className={styles.dependencyOption}>
                <span>{id}</span>
                {editing.targets.refused[id] ? <span className={styles.fieldText}>{editing.targets.refused[id]}</span> : null}
              </span>
            ),
            value: id,
          }))}
          placeholder='Add dependency'
          size='small'
        />
      ) : null}
    </Field>
  )
}

const NodeFields = ({ editing, hasFile, levels, node, onOpenFile, onRefusal }: {
  editing: NodeEditing
  hasFile: (path: string) => boolean
  levels: Record<string, number> | null
  node: ResourceNode
  onOpenFile: (path: string) => void
  onRefusal: (reason: string | null) => void
}) => {
  const ready = readiness(node)
  const level = levels ? levelOf(levels, node.id) : undefined
  let enters = 'unknown while the dependencies form a cycle'
  if (node.lifecycle) {
    enters = 'outside the sequence'
  } else if (level !== undefined) {
    enters = `S${level + 1}`
  }
  const current = node.readyWhen ?? (defaultReadiness(node) ? '' : null)
  return (
    <>
      <Field label='Kind'>
        <span className={styles.fieldValue}>{`${node.kind} · ${node.apiVersion}`}</span>
        <span className={styles.fieldText}>{`API group ${apiGroup(node.apiVersion)}`}</span>
      </Field>
      <Field label='Template'>
        {hasFile(node.template) ? (
          <button className={styles.pathLink} onClick={() => onOpenFile(node.template)} type='button'>{node.template}</button>
        ) : (
          <>
            <span className={styles.fieldValue}>{node.template}</span>
            <span className={styles.fieldText}>
              not in the chart yet — nothing renders this resource until the file exists. Write it in Chart files, or
              ask Autopilot to.
            </span>
          </>
        )}
      </Field>
      <DependsOn editing={editing} node={node} onRefusal={onRefusal} />
      <Field label={ready.label}>
        <Select
          aria-label='Ready when'
          onChange={(value: string) => onRefusal(editing.onSetReadyWhen(value === '' ? null : value))}
          options={editing.readyWhen.options.map((option) => ({ label: option.label, value: option.value }))}
          placeholder={MISSING_READINESS}
          size='small'
          value={current ?? undefined}
        />
        {editing.readyWhen.sentence ? <span className={styles.fieldText}>{editing.readyWhen.sentence}</span> : null}
        {ready.note ? <span className={styles.fieldText}>{ready.note}</span> : null}
        {ready.kstatus ? <span className={styles.fieldText}>this kind&apos;s own readiness — what a gate on it waits for</span> : null}
      </Field>
      {node.when ? (
        <Field label='When'>
          <span className={styles.fieldValue}>{node.when}</span>
          <span className={styles.fieldText}>renders only when this value is set</span>
        </Field>
      ) : null}
      {node.forEach ? (
        <Field label='For each'>
          <span className={styles.fieldValue}>{node.forEach}</span>
          <span className={styles.fieldText}>one object per item</span>
        </Field>
      ) : null}
      {node.lifecycle ? (
        <Field label='Lifecycle'>
          <span className={styles.fieldValue}>{node.lifecycle}</span>
          <span className={styles.fieldText}>
            {node.lifecycle === 'shim' ? 'renders while a legacy reference exists — not part of the sequence' : 'the descriptor itself — not part of the sequence'}
          </span>
        </Field>
      ) : null}
      <Field label='Enters'>
        <span className={styles.fieldValue}>{enters}</span>
      </Field>
    </>
  )
}

/**
 * "One per item of" — a placed node's `forEach`, set or cleared through the kernel. The answer is
 * the kernel's or the provider's refusal, said under the field; an accepted one is simply the node
 * redrawn with ×N.
 */
const ForEachField = ({ node, onSetForEach }: { node: ResourceNode; onSetForEach: (id: string, forEach: string | null) => string | null }) => {
  const [value, setValue] = useState(node.forEach ?? '')
  const [refusal, setRefusal] = useState<string | null>(null)
  const refusalId = useId()
  // Another node, or the same node changed under the field (Undo, an agent's write): start from what it holds.
  useEffect(() => {
    setValue(node.forEach ?? '')
    setRefusal(null)
  }, [node.id, node.forEach])
  // Enter on what the node already holds asks for nothing, the same as the disabled Set beside it.
  const unchanged = value.trim() === (node.forEach ?? '')
  const apply = () => {
    if (!unchanged) {
      setRefusal(onSetForEach(node.id, value.trim() || null))
    }
  }
  return (
    <Field label='One per item of'>
      <div className={styles.addFieldRow}>
        <Input
          aria-describedby={refusal ? refusalId : undefined}
          aria-label='One per item of'
          onChange={(event) => { setValue(event.target.value); setRefusal(null) }}
          onPressEnter={apply}
          placeholder='.Values.files'
          size='small'
          value={value}
        />
        <Button disabled={unchanged} onClick={apply} size='small'>Set</Button>
      </div>
      {refusal
        ? <span className={styles.refusalText} id={refusalId} role='alert'>{refusal}</span>
        : <span className={styles.fieldText}>A bare path (.Values.files) or a named helper (builder-publish.files). Empty: one object.</span>}
    </Field>
  )
}

export const NodeInspector = ({
  editing,
  fileCount,
  hasFile,
  levels,
  node,
  onClear,
  onOpenFile,
  onOpenFormEditor,
  onSetForEach,
  placedNote,
  schemaText,
  templateText,
}: {
  /** The node's editing — its edges, its readiness, its removal (null with no node selected). */
  editing: NodeEditing | null
  /** How many files the held chart has — the placed note says it. */
  fileCount: number
  /** Whether the held chart has this path — a template the descriptor names may not exist yet. */
  hasFile: (path: string) => boolean
  /** The derived levels, or null when there are none (a cycle). */
  levels: Record<string, number> | null
  /** The selected resource, or null. */
  node: ResourceNode | null
  onClear: () => void
  onOpenFile: (path: string) => void
  onOpenFormEditor: () => void
  /** Range the node over a list (or stop): null when it was written, else why not. */
  onSetForEach: (id: string, forEach: string | null) => string | null
  /**
   * Set while the selected node is the one just placed: what the note says about it. `specNote` is
   * a whole clause — "Its CRD could not be read (…)" or "Its CRD declares no spec schema at …".
   */
  placedNote: { specNote?: string } | null
  /** The held values.schema.json, verbatim — the form preview's input. */
  schemaText: string | undefined
  /** The selected node's template, when the chart holds it — whether it was placed decides "One per item of". */
  templateText: string | undefined
}) => {
  const formGap = formPreviewGap(schemaText)
  const placed = !!templateText?.includes(PLACED_MARKER)
  // Why the last edit here was not written — said under the node, until the next one.
  const [refusal, setRefusal] = useState<string | null>(null)
  useEffect(() => { setRefusal(null) }, [node?.id])
  return (
    <section aria-label='Inspector' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Inspector</span>
        {node ? <span className={styles.countPill}>{node.class}</span> : null}
        <span className={styles.spacer} />
        {node ? <Button onClick={onClear} size='small' type='link'>Clear</Button> : null}
      </div>
      <div className={styles.section} data-testid='inspector'>
        {node ? (
          <>
            <Field label='Node'>
              <span className={styles.fieldValue}>{node.id}</span>
            </Field>
            {editing ? <NodeFields editing={editing} hasFile={hasFile} levels={levels} node={node} onOpenFile={onOpenFile} onRefusal={setRefusal} /> : null}
            {refusal ? <div className={styles.schemaRefusal} role='alert'>{refusal}</div> : null}
            {placed && !node.lifecycle ? <ForEachField node={node} onSetForEach={onSetForEach} /> : null}
            {placedNote ? (
              <p className={styles.note} data-testid='placed-note'>
                Placing this node changed the chart, so publishing is off until <strong>Preview</strong> renders it again. The
                chart has <strong>{counted(fileCount, 'file')}</strong>, and there is no cap on how many it can have.
                {placedNote.specNote ? ` ${placedNote.specNote}, so spec is empty — fill it in Chart files.` : null}
              </p>
            ) : null}
            {editing ? (
              <Popconfirm
                cancelText='Keep it'
                okText='Remove'
                onConfirm={() => setRefusal(editing.onRemoveNode())}
                title={`Remove ${node.id} from the chart? Its template and every edge onto it go with it.`}
              >
                <Button danger size='small'>Remove from chart</Button>
              </Popconfirm>
            ) : null}
          </>
        ) : (
          <p className={styles.fieldText}>Select a node to see what it is, what it waits for and when it is ready. Below: the create form this chart would generate.</p>
        )}
        <div className={styles.formHead}>
          <Button onClick={onOpenFormEditor} size='small'>Open form editor</Button>
        </div>
        {formGap
          ? <p className={styles.dashedNote}>{formGap}</p>
          : <PreviewFormSection formSchema={schemaText ?? ''} suppressed={formSuppressions(schemaText ?? '')} />}
      </div>
    </section>
  )
}

export default NodeInspector
