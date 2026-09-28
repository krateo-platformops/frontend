/**
 * The Conditions strip (mockup screens 8b/8c): one switch per `when` path, starting at what
 * values.yaml gives, switching which variant of the machine the stepper and the canvas show. A
 * VIEW control — it writes nothing — so it never disarms publish. Renders nothing for a chart
 * with no conditions.
 */
import { Button, Segmented } from 'antd'

import canvas from './ArchitectureCanvas.module.css'
import styles from './BlueprintComposer.module.css'
import type { Condition } from './conditions'

export interface ConditionsStripProps {
  conditions: readonly Condition[]
  positions: Readonly<Record<string, boolean>>
  onChange: (path: string, on: boolean) => void
  onReset: () => void
}

const defaultNote = (condition: Condition): string => {
  if (!condition.inValues) { return 'not in values.yaml — an install supplies it' }
  return condition.byDefault ? 'values.yaml sets it' : 'values.yaml leaves it empty'
}

export const ConditionsStrip = ({ conditions, onChange, onReset, positions }: ConditionsStripProps) => {
  if (!conditions.length) {
    return null
  }
  const changed = conditions.some((condition) => positions[condition.path] !== condition.byDefault)
  return (
    <div aria-label='Conditions' className={canvas.conditions} role='group'>
      <span className={styles.eyebrow}>Conditions</span>
      {conditions.map((condition) => (
        <span className={canvas.condition} key={condition.path}>
          <code>{condition.path}</code>
          <Segmented
            aria-label={condition.path}
            onChange={(value) => onChange(condition.path, value === 'set')}
            options={[{ label: 'set', value: 'set' }, { label: 'empty', value: 'empty' }]}
            size='small'
            value={positions[condition.path] === false ? 'empty' : 'set'}
          />
          <span className={styles.fieldText}>
            {defaultNote(condition)}
          </span>
        </span>
      ))}
      {changed ? <Button onClick={onReset} size='small'>Back to the default</Button> : null}
    </div>
  )
}
