/**
 * What the Controller Composer shows when there is no controller for it to edit (T8, frontend#412).
 *
 * TWO CASES, as the Blueprint Composer's:
 *   - Nothing is held: say so, and offer Start.
 *   - Another builder's draft is held. One store holds one draft, so this composer cannot start a
 *     controller while it is there — and it never reads a chart or a page as a controller. The draft is
 *     PARKED: named by its kind, with the way to the composer that edits it, and a way to discard it.
 */
import { Button, Popconfirm, Space } from 'antd'
import { Link } from 'react-router'

import { findBuilderOf } from '../../builders/builderRegistry'
import { findDraftKindPlugin } from '../../builders/draftKinds'
import { WidgetEmpty } from '../../components/WidgetStates'

export const CONTROLLER_EMPTY = 'No controller open. Start one here, or ask Autopilot to draft one — either way you review every file before anything is published.'

export const ControllerEmptyState = ({ builder, held, onDiscard, onStart, parked }: {
  /** This composer's Builder label. */
  builder: string
  /** The kind of the draft that is held, when one is. */
  held: string | null
  onDiscard: () => void
  onStart: () => void
  parked: boolean
}) => {
  if (parked) {
    const owner = findBuilderOf(held)
    const artifact = findDraftKindPlugin(held)?.nouns.artifact ?? 'another builder\'s'
    return (
      <WidgetEmpty
        description={`${artifact.charAt(0).toUpperCase()}${artifact.slice(1)} draft is open in this thread. The ${builder} edits controllers — finish or publish it${owner ? ` in the ${owner.label}` : ''}, or discard it to start a controller here.`}
      >
        <Space wrap>
          {/* Client-side: the held draft lives in this tab's memory, and a full load would drop it. */}
          {owner ? <Link to={owner.route}>{`Open it in the ${owner.label}`}</Link> : null}
          <Popconfirm cancelText='Keep it' okText='Discard' onConfirm={onDiscard} title='Discard that draft? Its unpublished files are deleted.'>
            <Button>Discard the draft</Button>
          </Popconfirm>
        </Space>
      </WidgetEmpty>
    )
  }
  return (
    <WidgetEmpty description={CONTROLLER_EMPTY}>
      <Button onClick={onStart} type='primary'>Start a controller</Button>
    </WidgetEmpty>
  )
}

export default ControllerEmptyState
