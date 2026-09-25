/**
 * The Inspector — mockup screens 3 and 5: the selected resource, read-only, and below it the create
 * form this chart would generate.
 *
 * READ-ONLY IN THIS STAGE, and it says so. Every field is the descriptor's own; editing them (the
 * `ready` toggle, the `readyWhen` picker over the target's status schema) lands with the palette
 * and `planEdge`, so that a person and the agent go through the same legality check. Until then the
 * way to change a node is its text, and the template path here opens that text in Chart files.
 *
 * READINESS IS ALWAYS ANSWERED. A node with no `readyWhen` still has a meaning for "ready" — its
 * class default (kstatus for native, Ready and Synced for a composition) — or, for a custom
 * resource, none at all, which is what makes a `ready: true` edge onto it unsatisfiable. The panel
 * says which of the three it is rather than leaving a blank that reads as "fine".
 *
 * THE FORM is `PreviewFormSection` — the drawer's, over the same values.schema.json — so a consumer's
 * create form is previewed one way everywhere. When there is nothing to preview, the reason is named.
 */
import { Button } from 'antd'

import { PreviewFormSection } from '../../components/Autopilot/previewFormSection'

import { levelOf, type ResourceNode } from './architecture'
import { apiGroup } from './architectureView'
import styles from './BlueprintComposer.module.css'
import { formPreviewGap } from './formPreview'
import { MISSING_READINESS, READINESS_DEFAULTS } from './stepperModel'

const Field = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className={styles.field}>
    <span className={styles.eyebrow}>{label}</span>
    {children}
  </div>
)

const readiness = (node: ResourceNode): { label: string; value: string; note?: string } => {
  if (node.readyWhen) {
    return { label: 'Ready when', value: node.readyWhen }
  }
  const fallback = READINESS_DEFAULTS[node.class]
  return fallback
    ? { label: 'Ready when · default for this class', value: fallback }
    : { label: 'Ready when', note: 'A custom resource has no default, so nothing can wait on its readiness until one is declared.', value: MISSING_READINESS }
}

const NodeFields = ({ levels, node, onOpenFile }: {
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
        <button className={styles.pathLink} onClick={() => onOpenFile(node.template)} type='button'>{node.template}</button>
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

export const NodeInspector = ({ levels, node, onClear, onOpenFile, schemaText }: {
  /** The derived levels, or null when there are none (a cycle). */
  levels: Record<string, number> | null
  /** The selected resource, or null. */
  node: ResourceNode | null
  onClear: () => void
  onOpenFile: (path: string) => void
  /** The held values.schema.json, verbatim — the form preview's input. */
  schemaText: string | undefined
}) => {
  const formGap = formPreviewGap(schemaText)
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
            <NodeFields levels={levels} node={node} onOpenFile={onOpenFile} />
            <p className={styles.note}>Read-only for now — change a node in its text, in Chart files. Editing it here arrives with the palette.</p>
          </>
        ) : (
          <p className={styles.fieldText}>Select a node to see what it is, what it waits for and when it is ready. Below: the create form this chart would generate.</p>
        )}
        {formGap
          ? <p className={styles.dashedNote}>{formGap}</p>
          : <PreviewFormSection formSchema={schemaText ?? ''} />}
      </div>
    </section>
  )
}

export default NodeInspector
