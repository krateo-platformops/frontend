import type { IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button as AntdButton } from 'antd'
import useApp from 'antd/es/app/useApp'

import { dismissButtonProps } from '../../components/DismissButton'
import { useHandleAction } from '../../hooks/useHandleActions'
import { getColorCode } from '../../theme/palette'
import type { WidgetProps } from '../../types/Widget'

import type { Button as WidgetType } from './Button.type'

export type ButtonWidgetData = WidgetType['spec']['widgetData']

const Button = ({ deniedRefIds, resourcesRefs, uid, widget, widgetData }: WidgetProps<ButtonWidgetData>) => {
  const { actions, ariaLabel, block, clickActionId, color, danger, disabled, ghost, icon, iconColor, intent, label, shape, size, type, variant } = widgetData

  const { notification } = useApp()
  const { handleAction, isActionLoading } = useHandleAction()

  const action = Object.values(actions)
    .flat()
    .find(({ id }) => id === clickActionId)

  const onClick = async () => {
    if (!action) {
      notification.error({
        description: `The widget definition does not include an action (ID: ${clickActionId})`,
        message: 'Error while executing the action',
        placement: 'bottomLeft',
      })

      return
    }

    await handleAction(action, resourcesRefs, undefined, widget, undefined, deniedRefIds)
  }

  const handleClick = (event: React.MouseEvent<HTMLElement, MouseEvent>) => {
    event.stopPropagation()

    onClick().catch((error) => {
      console.error('Error in button click handler:', error)
    })
  }

  // WCAG: icon-only buttons (icon set, no visible label) need an accessible name.
  // Derive it from: 1) explicit ariaLabel field, 2) the matched action id.
  // Buttons with a visible label already have an accessible name via their text content.
  const isIconOnly = Boolean(icon) && !label
  const computedAriaLabel = isIconOnly ? (ariaLabel ?? action?.id) : undefined

  // C26: a dismiss button is amber and outlined whatever else the CR says — the role IS the look.
  const role = intent === 'dismiss'
    ? { ...dismissButtonProps, danger: false, type: 'default' as const }
    : { color, danger, type: type || 'primary', variant }

  return (
    <div>
      <AntdButton
        aria-label={computedAriaLabel}
        block={block}
        {...role}
        disabled={disabled}
        ghost={ghost}
        icon={icon ? <FontAwesomeIcon icon={icon as IconProp} style={iconColor ? { color: getColorCode(iconColor) } : undefined} /> : undefined}
        key={uid}
        loading={isActionLoading}
        onClick={(event) => handleClick(event)}
        shape={shape || 'default'}
        size={size || 'middle'}
      >
        {label}
      </AntdButton>
    </div>
  )
}

export default Button
