/**
 * What the page composer shows when nothing it can edit is open.
 *
 * Either no draft at all — say how to start one — or the draft this thread holds is a CHART: not a
 * fake canvas and not silence, but a sentence naming it, because this surface has no business
 * rewriting a blueprint. And a way out: one store holds one draft, so a parked chart blocks every
 * page start until it is discarded, and a composer that only said so would leave the person to
 * find the drawer that can.
 */
import { Button, Popconfirm } from 'antd'

import { WidgetEmpty } from '../../components/WidgetStates'

export const ComposerEmptyState = ({ onDiscard, onStart, parkedBlueprint }: {
  onDiscard: () => void
  onStart: () => void
  parkedBlueprint: boolean
}) => {
  if (parkedBlueprint) {
    return (
      <WidgetEmpty
        description='A blueprint draft is open in this thread. This composer edits pages — discard that draft to start a page here.'
      >
        <Popconfirm
          cancelText='Keep it'
          okText='Discard'
          onConfirm={onDiscard}
          title='Discard the blueprint draft? Its unpublished files are deleted.'
        >
          <Button>Discard blueprint draft</Button>
        </Popconfirm>
      </WidgetEmpty>
    )
  }
  return (
    <WidgetEmpty
      description='No draft open. Start a page here, or ask Autopilot to draft one — either way you review every file before anything is published.'
    >
      <Button onClick={onStart} type='primary'>Start a page</Button>
    </WidgetEmpty>
  )
}
