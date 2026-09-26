/**
 * The Inspector — mockup screens 3 and 5: the selected resource, and below it the create form this
 * chart would generate.
 *
 * MOSTLY READ-ONLY IN THIS STAGE, and it says so. What a node waits for and when it is ready — the
 * `ready` toggle, the `readyWhen` picker over the target's status schema — land with edge drawing
 * and `planEdge` (S4b), so that a person and the agent go through the same legality check. What IS
 * editable here is "One per item of" on a node the palette placed: its template is still the shape
 * placing wrote, so ranging it is a kernel's job, not a hand edit (planPlace's setForEach).
 *
 * A TEMPLATE THE CHART DOES NOT HOLD IS SAID, not linked. A resource added by editing the
 * architecture file has no template until someone writes one, and a link to a file that is not there
 * opened nothing, silently. The path is shown as text with what that means.
 *
 * READINESS IS ALWAYS ANSWERED. A node with no `readyWhen` still has a meaning for "ready" — its
 * class default (existence, for a native resource or a composition: what the gate checks) — or, for
 * a custom resource, none at all, which is what makes a `ready: true` edge onto it unsatisfiable.
 * The panel says which of the three it is rather than leaving a blank that reads as "fine". A native
 * kind the palette knows also says its OWN kstatus meaning, in that kind's words ("available",
 * "bound"), beside what the gate checks today — never in its place: the gate compiles that meaning
 * only once it can (S4b), and until then the answer is existence.
 *
 * JUST PLACED, it says what placing did: the chart changed, so Publish is off until Preview renders
 * it again — and how many files the chart now has, with no cap to measure them against (#367).
 *
 * THE FORM is `PreviewFormSection` — the drawer's, over the same values.schema.json — so a consumer's
 * create form is previewed one way everywhere, with any field whose schema has a crdgen problem left
 * out and named. "Open form editor" opens it out (screen 10). When there is nothing to preview, the
 * reason is named.
 */
import { Button, Input } from 'antd'
import { useEffect, useId, useState } from 'react'

import { PreviewFormSection } from '../../components/Autopilot/previewFormSection'

import { levelOf, type ResourceNode } from './architecture'
import { apiGroup, counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import { formPreviewGap } from './formPreview'
import { nativeKindOf } from './nativeKinds'
import { formSuppressions } from './schemaEdit'
import { MISSING_READINESS, READINESS_DEFAULTS } from './stepperModel'
import { PLACED_MARKER } from './templateGen'

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className={styles.field}>
    <span className={styles.eyebrow}>{label}</span>
    {children}
  </div>
)

const readiness = (node: ResourceNode): { label: string; value: string; note?: string; kstatus?: string } => {
  if (node.readyWhen) {
    return { label: 'Ready when', value: node.readyWhen }
  }
  const fallback = READINESS_DEFAULTS[node.class]
  if (!fallback) {
    return { label: 'Ready when', note: 'A custom resource has no default, so nothing can wait on its readiness until one is declared.', value: MISSING_READINESS }
  }
  // A native kind the palette knows says its OWN kstatus meaning — "available", "bound" — beside
  // the existence the gate checks today, not instead of it.
  const native = node.class === 'native' ? nativeKindOf(node.apiVersion, node.kind) : null
  return native
    ? { kstatus: `kstatus · ${native.label}`, label: 'Ready when · default for this class', value: fallback }
    : { label: 'Ready when · default for this class', value: fallback }
}

const NodeFields = ({ hasFile, levels, node, onOpenFile }: {
  hasFile: (path: string) => boolean
  levels: Record<string, number> | null
  node: ResourceNode
  onOpenFile: (path: string) => void
}) => {
  const ready = readiness(node)
  const level = levels ? levelOf(levels, node.id) : undefined
  let enters = 'unknown while the dependencies form a cycle'
  if (node.lifecycle) {
    enters = 'outside the sequence'
  } else if (level !== undefined) {
    enters = `S${level + 1}`
  }
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
      <Field label='Depends on'>
        {node.dependsOn?.length ? (
          <ul className={styles.plainList}>
            {node.dependsOn.map((dep) => (
              <li key={dep.ref}>
                <span className={styles.fieldValue}>{dep.ref}</span>
                <span className={styles.fieldText}>
                  {[
                    dep.ready ? ' — waits until it is ready' : ' — waits until it exists',
                    dep.all ? ', every instance' : '',
                    dep.when ? `, only when ${dep.when} is set` : '',
                  ].join('')}
                </span>
              </li>
            ))}
          </ul>
        ) : <span className={styles.fieldText}>nothing — it does not wait for anything</span>}
      </Field>
      <Field label={ready.label}>
        <span className={styles.fieldValue}>{ready.value}</span>
        {ready.note ? <span className={styles.fieldText}>{ready.note}</span> : null}
        {ready.kstatus ? (
          <span className={styles.fieldText}>
            <span>{ready.kstatus}</span> — this kind&apos;s own readiness; until a readyWhen says more, the gate checks only that it exists
          </span>
        ) : null}
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
            <NodeFields hasFile={hasFile} levels={levels} node={node} onOpenFile={onOpenFile} />
            {placed && !node.lifecycle ? <ForEachField node={node} onSetForEach={onSetForEach} /> : null}
            {placedNote ? (
              <p className={styles.note} data-testid='placed-note'>
                Placing this node changed the chart, so publishing is off until <strong>Preview</strong> renders it again. The
                chart has <strong>{counted(fileCount, 'file')}</strong>, and there is no cap on how many it can have.
                {placedNote.specNote ? ` ${placedNote.specNote}, so spec is empty — fill it in Chart files.` : null}
              </p>
            ) : null}
            <p className={styles.note}>
              Read-only for now: what it waits for and when it is ready — change those in templates/architecture.yaml, in
              Chart files. Drawing an edge arrives next.
            </p>
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
