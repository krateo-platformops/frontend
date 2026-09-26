/**
 * Declared-vs-gated DRIFT, put back. A person's Chart files edit of a gate block — or of the
 * descriptor — can leave a template's gate out of step with templates/architecture.yaml; the held
 * draft's lint (lintHeldDraft) then refuses Preview and Publish and names the template. This is the
 * one control that answers it: regenerate every drifted gate from the descriptor, in one guarded
 * batch, leaving the rest of each template as it is. Nothing renders while nothing has drifted.
 */
import { Button } from 'antd'
import { useMemo, useState } from 'react'

import { emitFilesBatch } from '../../components/Autopilot/previewFilesBatch'

import { counted } from './architectureView'
import styles from './BlueprintComposer.module.css'
import { gateDrift, regenerateGates } from './planEdge'

export const GateDriftAction = ({ files }: { files: Readonly<Record<string, string>> }) => {
  const drifted = useMemo(() => gateDrift(files), [files])
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!drifted.length) {
    return null
  }
  const regenerate = () => {
    const next = regenerateGates(files)
    const outcome = emitFilesBatch({
      edit: Object.fromEntries(drifted.map((path) => [path, next[path]])),
      expect: Object.fromEntries(drifted.map((path) => [path, files[path]])),
      kind: 'blueprint',
    })
    setRefusal(outcome?.ok ? null : `Nothing was written — ${outcome ? outcome.error : 'no provider answered, so the draft did not change'}`)
  }
  return (
    <div className={styles.driftRow}>
      <Button onClick={regenerate} size='small'>{`Regenerate gates (${counted(drifted.length, 'template')})`}</Button>
      <span className={styles.fieldText}>Rewrites each gate from templates/architecture.yaml; the rest of each template is left as it is.</span>
      {refusal ? <span className={styles.fieldText} role='alert'>{refusal}</span> : null}
    </div>
  )
}
