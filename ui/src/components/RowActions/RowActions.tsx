import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { App, Button, Dropdown, Space } from 'antd'

import { useHandleAction } from '../../hooks/useHandleActions'
import type { ResourcesRefs, Widget, WidgetAction, WidgetActions } from '../../types/Widget'

/**
 * `rowActions` — the per-row verbs of a collection widget, shared by List (`itemTemplate.rowActions`)
 * and Table (`widgetData.rowActions`, #700) so the two read the same field the same way.
 *
 * Each entry names an action in the widget's own `widgetData.actions` map; firing it dispatches that
 * action with the ROW as its payload (customPayload), so one action definition serves every row: a
 * navigate `path` of `/x/${name}` goes to that row's `name`. The descriptors are static (the same
 * verbs on every row); the row's data flows in at click time.
 *
 * Distinct from the whole-row click (List `navigateTo`, Table `rowNavigateTo`): neither a click on a
 * control nor the Enter/Space that activates one ever reaches the row.
 */
export interface RowAction {
  actionId: string
  label: string
  /** Optional Font Awesome icon name for the menu item. */
  icon?: string
  /** Render the menu item in a destructive (red) style. */
  danger?: boolean
}

export type RowActionsDisplay = 'menu' | 'buttons'

/**
 * Returns the function that fires one row action: look the id up in the widget's action map and
 * dispatch it with `row` as customPayload. An id the map does not define is reported, not ignored.
 * `noun` names the widget in that report ("The list does not define an action").
 */
export const useFireRowAction = ({ actions, deniedRefIds, noun, resourcesRefs, widget }: {
  actions?: WidgetActions
  deniedRefIds?: string[]
  noun: 'list' | 'table'
  resourcesRefs?: ResourcesRefs
  widget?: Widget
}) => {
  // `App.useApp()`, not `antd/es/app/useApp`: the same hook in the app's bundle, and the one that
  // reads the `<App>` a test renders (the `es` path resolves to a second copy of its context there).
  const { notification } = App.useApp()
  const { handleAction } = useHandleAction()

  return async (actionId: string, row: unknown) => {
    const allActions = (actions ? Object.values(actions).flat() : []) as WidgetAction[]
    const action = allActions.find((candidate) => candidate.id === actionId)
    if (!action) {
      notification.error({
        description: `The ${noun} does not define an action (ID: ${actionId})`,
        message: 'Error while executing the action',
        placement: 'bottomLeft',
      })
      return
    }
    await handleAction(action, resourcesRefs ?? { items: [] }, row as Record<string, unknown>, widget, undefined, deniedRefIds)
  }
}

/**
 * The row's action control: a kebab (⋯) menu (`menu`, the default) or antd Buttons in declared
 * order, the first primary and a `danger` entry as danger (`buttons`). One Space holding the
 * buttons, not one slot per button, so a host that separates its slots (antd List.Item `actions`)
 * draws no divider between two verbs.
 *
 * Renders nothing for an empty list, so a host can place it unconditionally. `size` is the buttons'
 * (the kebab is always small): List's rows take `middle`; a Table row is one line of text, and a
 * taller control would make it taller (see Table.tsx).
 */
export const RowActionControls = ({ display, onFire, rowActions, size = 'middle' }: {
  display?: RowActionsDisplay
  onFire: (actionId: string) => void
  rowActions: RowAction[]
  size?: 'small' | 'middle'
}) => {
  if (!rowActions.length) { return null }

  if (display === 'buttons') {
    return (
      <Space size='small'>
        {rowActions.map((rowAction, actionIndex) => (
          <Button
            danger={rowAction.danger}
            icon={rowAction.icon ? <FontAwesomeIcon icon={rowAction.icon as IconProp} /> : undefined}
            key={rowAction.actionId}
            // Neither a click nor the Enter/Space that activates the button may reach the row:
            // the row's own onKeyDown would navigate and preventDefault the button's click away.
            onClick={(event) => { event.stopPropagation(); onFire(rowAction.actionId) }}
            onKeyDown={(event) => { event.stopPropagation() }}
            size={size}
            type={actionIndex === 0 ? 'primary' : 'default'}
          >
            {rowAction.label}
          </Button>
        ))}
      </Space>
    )
  }

  return (
    <Dropdown
      menu={{
        items: rowActions.map((rowAction) => ({
          danger: rowAction.danger,
          icon: rowAction.icon ? <FontAwesomeIcon icon={rowAction.icon as IconProp} /> : undefined,
          key: rowAction.actionId,
          label: rowAction.label,
        })),
        onClick: ({ domEvent, key }) => {
          // Don't let the menu click bubble to the row's navigate onClick.
          domEvent.stopPropagation()
          onFire(key)
        },
      }}
      trigger={['click']}
    >
      <Button
        aria-label='Row actions'
        icon={<FontAwesomeIcon icon={'fa-ellipsis-vertical' as IconProp} />}
        onClick={(event) => { event.stopPropagation() }}
        size='small'
        type='text'
      />
    </Dropdown>
  )
}
