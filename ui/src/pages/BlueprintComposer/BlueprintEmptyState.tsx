/**
 * What the Blueprint Composer shows when there is no chart for it to edit.
 *
 * TWO CASES, and each names what is missing and what to do (C14, P16):
 *
 *   - Nothing is held. Say so, and offer Start — the Portal Builder's empty state, for charts.
 *   - A PORTAL PAGE draft is held. One store holds one draft, so this composer cannot start a chart
 *     while it is there, and it has no business reading a page set as a chart: page drafts carry a
 *     Chart.yaml and a values.schema.json too, and a graph drawn from them would be nonsense that
 *     looks like a chart. So the page is PARKED — named, never read — with the way to it, and a way
 *     to discard it for someone who came here to start a chart. The mirror of the Page Composer
 *     parking a blueprint.
 *
 * Through `WidgetEmpty`, the shared empty treatment, with its action slot.
 */
import { Button, Popconfirm, Space } from 'antd'
import { Link } from 'react-router'

import { WidgetEmpty } from '../../components/WidgetStates'

export const PORTAL_BUILDER_COMPOSE_PATH = '/portal-builder/compose'

export const BlueprintEmptyState = ({ onDiscard, onStart, parkedPage }: {
  onDiscard: () => void
  onStart: () => void
  parkedPage: boolean
}) => {
  if (parkedPage) {
    return (
      <WidgetEmpty
        description='A portal page draft is open in this thread. This composer edits blueprints — finish or publish the page in the Portal Builder, or discard it to start a chart here.'
      >
        <Space wrap>
          {/* A client-side navigation: the held draft lives in this tab's memory, and a full page
              load would drop the very draft it is sending the person to. */}
          <Link to={PORTAL_BUILDER_COMPOSE_PATH}>Open the page in the Portal Builder</Link>
          <Popconfirm
            cancelText='Keep it'
            okText='Discard'
            onConfirm={onDiscard}
            title='Discard the page draft? Its unpublished files are deleted.'
          >
            <Button>Discard page draft</Button>
          </Popconfirm>
        </Space>
      </WidgetEmpty>
    )
  }
  return (
    <WidgetEmpty
      description='No chart open. Start one here, or ask Autopilot to draft one — either way you review every file before anything is published.'
    >
      <Button onClick={onStart} type='primary'>Start a chart</Button>
    </WidgetEmpty>
  )
}

export default BlueprintEmptyState
