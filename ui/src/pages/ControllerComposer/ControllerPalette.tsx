/**
 * The `openapi` palette (T8, frontend#412): "Add" — the held document's operations grouped by
 * resource path (T7's paletteModel), filtered by path or operation, each group with its count.
 *
 * TWO GESTURES, both by drag and both by keyboard:
 *   - a GROUP becomes a Kind — dragged onto Resources, or its Place button;
 *   - one OPERATION becomes one verb of a Kind — dragged onto that Kind's card (the inspector's verbs
 *     table is the keyboard way to the same edit).
 * A group already placed says what it became. A placement that did not land says why under its group.
 */
import { Alert, Button, Input } from 'antd'
import { Fragment, useMemo, useState } from 'react'

import styles from '../BlueprintComposer/BlueprintComposer.module.css'

import type { ControllerModel } from './controllerChart'
import own from './ControllerComposer.module.css'
import { buildControllerPalette } from './paletteModel'
import type { ControllerRefusal } from './useControllerWorkbench'

/** The drag payloads the canvas reads. */
export const DRAG_GROUP = 'application/x-krateo-oas-group'
export const DRAG_OPERATION = 'application/x-krateo-oas-operation'

const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

export const ControllerPalette = ({ model, onDismissRefusal, onPlace, refusal }: {
  model: ControllerModel
  onDismissRefusal: () => void
  onPlace: (group: string) => void
  refusal: ControllerRefusal | null
}) => {
  const [filter, setFilter] = useState('')
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const operations = model.spec?.oas.operations
  const palette = useMemo(() => buildControllerPalette(operations ?? [], filter), [filter, operations])
  const placedAs = new Map(model.kinds.map((entry) => [entry.group, entry.kind]))
  const filtering = !!palette.filter
  const expanded = (group: string): boolean => (Object.prototype.hasOwnProperty.call(toggled, group) ? toggled[group] : filtering)

  return (
    <section aria-label='Add' className={`${styles.pane} ${styles.palettePane}`}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Add</span>
      </div>
      <div aria-label='Palette' className={styles.paletteBody} role='group'>
        <Input
          allowClear
          aria-label='Filter by path or operation'
          onChange={(event) => { setFilter(event.target.value); setToggled({}) }}
          placeholder='Filter by path or operation'
          size='small'
          suffix={filtering && palette.groups.length ? <span className={styles.paletteMatches}>{`${counted(palette.groups.length, 'group')} ${palette.groups.length === 1 ? 'matches' : 'match'}`}</span> : undefined}
          value={filter}
        />
        {model.specProblem ? <p className={styles.paletteNote}>{model.specProblem}</p> : null}
        {palette.nothingMatches ? <p className={styles.fieldText}>{`Nothing matches “${palette.filter}”.`}</p> : null}
        <div className={styles.paletteSection}>
          <div className={styles.paletteSectionHead}>
            <span className={styles.eyebrow}>Operations</span>
            {operations ? <span className={styles.countPill}>{`${counted(palette.operations, 'operation')} · ${counted(palette.groups.length, 'group')}`}</span> : null}
          </div>
          {palette.groups.map((group) => {
            const placed = placedAs.get(group.group)
            return (
              <Fragment key={group.group}>
                {/* C8 exception: pointer drag source; the Place button below is the keyboard path to the same edit. */}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                <div
                  className={styles.paletteGroup}
                  data-group={group.group}
                  draggable={!placed}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_GROUP, group.group)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <div className={own.groupActions}>
                    <button
                      aria-expanded={expanded(group.group)}
                      className={styles.paletteGroupHead}
                      onClick={() => setToggled((last) => ({ ...last, [group.group]: !expanded(group.group) }))}
                      type='button'
                    >
                      <span aria-hidden='true'>{expanded(group.group) ? '▾' : '▸'}</span>
                      <span className={styles.paletteGroupName}>{`/${group.group}`}</span>
                      <span className={styles.countPill}>{filtering && group.operations.length !== group.total ? `${group.operations.length}/${group.total}` : String(group.total)}</span>
                    </button>
                    {placed ? (
                      <span className={styles.placedMark}>{`✓ ${placed}`}</span>
                    ) : (
                      <Button aria-label={`Place ${group.group} as a Kind`} onClick={() => onPlace(group.group)} size='small' type='link'>Place</Button>
                    )}
                  </div>
                  {expanded(group.group) ? group.operations.map((operation) => (
                    // C8 exception: pointer drag source; the operations table is the keyboard path to the same mapping.
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                      className={own.operation}
                      data-operation={operation.key}
                      draggable
                      key={operation.key}
                      onDragStart={(event) => {
                        event.stopPropagation()
                        event.dataTransfer.setData(DRAG_OPERATION, operation.key)
                        event.dataTransfer.effectAllowed = 'link'
                      }}
                      title={operation.summary ?? operation.operationId ?? undefined}
                    >
                      <span className={own.method}>{operation.method}</span>
                      <span>{operation.path}</span>
                    </div>
                  )) : null}
                </div>
                {refusal?.key === group.group ? <Alert closable onClose={onDismissRefusal} showIcon title={refusal.reason} type='error' /> : null}
              </Fragment>
            )
          })}
        </div>
        <p className={styles.note}>Drag a group onto Resources to map it as a Kind; drag one operation onto a Kind to make it one of its verbs.</p>
      </div>
    </section>
  )
}

export default ControllerPalette
