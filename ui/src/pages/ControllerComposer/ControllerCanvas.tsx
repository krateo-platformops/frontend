/**
 * The `restdef-graph` canvas (T8, frontend#412): "Resources" — one 156×72 card per Kind (eyebrow
 * `<Kind> · <group>`, its plural, the verbs it has) and, when the document declares security schemes,
 * the Configuration node the Kinds authenticate through, with an edge from each Kind to it.
 *
 * DROPS. A palette GROUP dropped anywhere on the canvas becomes a Kind; one OPERATION dropped on a
 * card becomes the verb its path shape says, on that Kind. A Kind with a verb nobody settled is marked
 * — the exception only; a settled Kind carries no mark.
 *
 * Plain DOM, not the chart canvas: a controller's Kinds do not depend on one another, so there is no
 * graph to lay out — a column of Kinds and the one node they all point at.
 */
import { Alert } from 'antd'
import { useState, type DragEvent } from 'react'

import styles from '../BlueprintComposer/BlueprintComposer.module.css'

import { heldVerb, pluralOf, type ControllerModel } from './controllerChart'
import own from './ControllerComposer.module.css'
import { DRAG_GROUP, DRAG_OPERATION } from './ControllerPalette'
import { securitySchemeSupport } from './oasImport'
import { VERB_ORDER } from './operationMapping'
import type { ControllerRefusal } from './useControllerWorkbench'

const CARD = { gap: 24, height: 72, width: 156 }
const PAD = 16
const CONFIG_X = PAD + CARD.width + 96

const accepts = (event: DragEvent, type: string): boolean => Array.from(event.dataTransfer?.types ?? []).includes(type)

export const ControllerCanvas = ({ model, onDismissRefusal, onDropGroup, onDropOperation, onSelect, refusal, selected }: {
  model: ControllerModel
  onDismissRefusal: () => void
  onDropGroup: (group: string) => void
  onDropOperation: (path: string, operation: string) => void
  onSelect: (path: string) => void
  refusal: ControllerRefusal | null
  selected: string | null
}) => {
  const [dropping, setDropping] = useState<string | null>(null)
  const schemes = model.spec ? securitySchemeSupport(model.spec.oas.doc) : []
  const rows = Math.max(model.kinds.length, 1)
  const height = PAD * 2 + rows * CARD.height + (rows - 1) * CARD.gap
  const configY = Math.max(PAD, Math.round(height / 2 - CARD.height / 2))
  const used = schemes.filter((scheme) => scheme.supported).map((scheme) => scheme.name)

  const onCanvasDrop = (event: DragEvent) => {
    setDropping(null)
    const group = event.dataTransfer?.getData(DRAG_GROUP)
    if (group) {
      event.preventDefault()
      onDropGroup(group)
    }
  }

  return (
    <section aria-label='Resources' className={styles.pane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Resources</span>
        {model.kinds.length ? <span className={styles.countPill}>{`${model.kinds.length} ${model.kinds.length === 1 ? 'Kind' : 'Kinds'}`}</span> : null}
      </div>
      {refusal ? <Alert closable onClose={onDismissRefusal} showIcon title={refusal.reason} type='error' /> : null}
      <div
        aria-label='Resources canvas — drop a resource group here to map it as a Kind'
        className={own.canvas}
        data-drop={dropping === 'canvas' ? 'true' : undefined}
        onDragLeave={() => setDropping(null)}
        onDragOver={(event) => {
          if (accepts(event, DRAG_GROUP)) {
            event.preventDefault()
            setDropping('canvas')
          }
        }}
        onDrop={onCanvasDrop}
        role='region'
      >
        {model.kinds.length ? (
          <div className={own.graph} style={{ height }}>
            {schemes.length ? (
              <svg aria-hidden='true' className={own.edges} height={height} width={CONFIG_X + CARD.width + PAD}>
                {model.kinds.map((entry, index) => {
                  const y = PAD + index * (CARD.height + CARD.gap) + CARD.height / 2
                  const x = PAD + CARD.width
                  return <path className={own.edge} d={`M ${x} ${y} C ${x + 48} ${y}, ${CONFIG_X - 48} ${configY + CARD.height / 2}, ${CONFIG_X} ${configY + CARD.height / 2}`} key={entry.path} />
                })}
              </svg>
            ) : null}
            {model.kinds.map((entry, index) => {
              const verbs = VERB_ORDER.filter((action) => heldVerb(entry.restDefinition, action))
              const conflicted = entry.conflicts.map((conflict) => conflict.action)
              return (
                <button
                  aria-label={`${entry.kind} — ${verbs.length ? verbs.join(', ') : 'no verbs'}${conflicted.length ? `; ${conflicted.join(', ')} to choose` : ''}`}
                  aria-pressed={selected === entry.path}
                  className={own.card}
                  data-conflict={conflicted.length ? 'true' : undefined}
                  data-drop={dropping === entry.path ? 'true' : undefined}
                  key={entry.path}
                  onClick={() => onSelect(entry.path)}
                  onDragLeave={() => setDropping(null)}
                  onDragOver={(event) => {
                    if (accepts(event, DRAG_OPERATION)) {
                      event.preventDefault()
                      event.stopPropagation()
                      setDropping(entry.path)
                    }
                  }}
                  onDrop={(event) => {
                    const operation = event.dataTransfer?.getData(DRAG_OPERATION)
                    if (operation) {
                      event.preventDefault()
                      event.stopPropagation()
                      setDropping(null)
                      onDropOperation(entry.path, operation)
                    }
                  }}
                  style={{ left: PAD, top: PAD + index * (CARD.height + CARD.gap) }}
                  type='button'
                >
                  <span className={own.cardEyebrow}>{`${entry.kind} · ${model.group}`}</span>
                  <span className={own.cardTitle}>{pluralOf(entry.kind)}</span>
                  <span className={own.cardVerbs}>
                    {verbs.join(' · ') || 'no verbs'}
                    {conflicted.length ? <span className={own.cardConflict}>{` · ${conflicted.join(', ')}: choose`}</span> : null}
                  </span>
                </button>
              )
            })}
            {schemes.length ? (
              <div className={`${own.card} ${own.configCard}`} style={{ left: CONFIG_X, top: configY }}>
                <span className={own.cardEyebrow}>{`Configuration · ${model.group}`}</span>
                <span className={own.cardTitle}>authentication</span>
                <span className={own.cardVerbs}>{used.length ? used.join(', ') : 'no scheme generated'}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={own.canvasEmpty}>
            <p className={own.canvasEmptyTitle}>No Kinds yet</p>
            <span>Drag a resource group from Add onto this canvas, or press Place on one — each group becomes one Kind, its operations its verbs.</span>
          </div>
        )}
      </div>
    </section>
  )
}

export default ControllerCanvas
