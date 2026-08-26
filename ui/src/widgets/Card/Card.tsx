import { findIconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { IconName, IconPrefix, IconProp } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Card as AntdCard, Badge, Button, Tag, Tooltip } from 'antd'
import useApp from 'antd/es/app/useApp'

import WidgetRenderer from '../../components/WidgetRenderer'
import { useHandleAction } from '../../hooks/useHandleActions'
import { getColorCode, getTagStyle } from '../../theme/palette'
import type { ResourcesRefs, WidgetAction, WidgetProps } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'

import styles from './Card.module.css'
import type { Card as WidgetType } from './Card.type'

export type CardWidgetData = WidgetType['spec']['widgetData']

/**
 * Resolve a FontAwesome icon name (e.g. "fa-aws", "fa-gauge") to a definition,
 * trying solid → brands → regular. The bare name defaults to the solid prefix,
 * where BRAND names (aws, google, …) don't exist — so without this they render as
 * a blank square. Falls back to a generic cube for unknown names.
 */
const resolveFaIcon = (name?: string): IconProp => {
  const iconName = (name ?? '').replace(/^fa-/, '') as IconName
  for (const prefix of ['fas', 'fab', 'far'] as IconPrefix[]) {
    const def = findIconDefinition({ iconName, prefix })
    if (def) { return def }
  }
  return ['fas', 'cube']
}

const FooterItem = ({ resourceRefId, resourcesRefs }: { resourceRefId: string; resourcesRefs: ResourcesRefs }) => {
  const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)
  if (!endpoint) { return null }

  // WidgetRenderer shows its own sized skeleton while loading, so the item keeps one stable
  // box across load → loaded. (Previously a `while-loading` class capped it to 100×100, which
  // snapped to the natural size on load — a visible pop.)
  return (
    <div className={styles.item}>
      <WidgetRenderer widgetEndpoint={endpoint}/>
    </div>
  )
}

const Card = ({ resourcesRefs, uid, widget, widgetData }: WidgetProps<CardWidgetData>) => {
  const { notification } = useApp()
  const { handleAction, isActionLoading } = useHandleAction()

  // antd Card reserves `actions` for footer nodes, so the Krateo event map is `widgetActions`.
  const { anchorId, clickActionId, cover, extra, extraRefId, extraStatus, extraVariant, footer, headerLeft, icon, items, legend, live, size, tags, title, titleVariant, tooltip, variant, widgetActions } = widgetData
  const coverEndpoint = cover ? getEndpointUrl(cover, resourcesRefs) : undefined
  // #83 §0.7: a real header-action slot — a nested widget (e.g. a Button with its own action) in the
  // card header's top-right, distinct from the plain-text `extra`. Unlike `extra` + `clickActionId`
  // (which makes the WHOLE card the click target), this action is self-contained.
  const extraEndpoint = extraRefId ? getEndpointUrl(extraRefId, resourcesRefs) : undefined

  const action: WidgetAction | undefined = Object.values(widgetActions ?? {})
    .flat()
    .find(({ id }) => id === clickActionId)

  const onClick = async () => {
    if (!action) {
      if (clickActionId) {
        notification.error({
          description: `The widget definition does not include an action (ID: ${clickActionId})`,
          message: 'Error while executing the action',
          placement: 'bottomLeft',
        })
      }

      return
    }

    await handleAction(action, resourcesRefs, undefined, widget)
  }

  const handleClick = () => {
    onClick().catch((error) => {
      console.error('Error in panel click handler:', error)
    })
  }

  // a11y: a clickable Card (one with a clickActionId) must be keyboard-operable — focusable,
  // announced as an actionable control, and activated by Enter/Space. A non-interactive card
  // (no clickActionId) stays a plain, non-focusable container.
  const isClickable = Boolean(clickActionId)
  const onKeyDown = isClickable
    ? (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleClick()
      }
    }
    : undefined

  const panelHeader = (
    <div className={styles.bodyHeader}>
      <div>{headerLeft}</div>
    </div>
  )
  const panelFooter = (
    <div className={`${styles.footer} ${!tags && footer?.length === 1 ? styles.single : ''}`}>
      {tags && tags.length > 0 && (
        <div className={styles.tags}>
          {tags.map((tag, index) => (
            <Tag key={`tag-${index}`}>{tag}</Tag>
          ))}
        </div>
      )}

      {footer && footer.length > 0 && (
        <div className={styles.items}>
          {footer.map(({ resourceRefId }, index) => (
            <FooterItem
              key={`${uid}-footer-${index}`}
              resourceRefId={resourceRefId}
              resourcesRefs={resourcesRefs}
            />
          ))}
        </div>
      )}
    </div>
  )

  // #86: the extra-value node (status Badge / soft Tag / plain text) as a helper — keeps the `extra`
  // JSX below free of a nested ternary (no-nested-ternary).
  const renderExtraValue = () => {
    if (extraVariant === 'badge') {
      return <Badge className={styles.statusBadge} status={(extraStatus ?? 'processing') as 'success' | 'processing' | 'warning' | 'error' | 'default'} text={extra} />
    }
    if (extraVariant === 'tag') {
      return <Tag style={getTagStyle(extraStatus)}>{extra}</Tag>
    }
    return extra
  }

  return (
    <AntdCard
      className={`${styles.panel} ${action ? styles.clickable : ''} ${!title && !cover && !footer && !!items?.length ? styles.statCard : ''} ${extraEndpoint ? styles.hasExtraAction : ''}`}
      classNames={{ body: styles.bodyWrapper, header: styles.header, title: styles.title }}
      cover={coverEndpoint ? <WidgetRenderer widgetEndpoint={coverEndpoint} /> : undefined}
      // `anchorId` makes this panel an in-page scroll target: a `[…](#anchorId)` link (e.g. from a
      // summary/table-of-contents Markdown widget) scrolls here. scroll-margin-top clears the sticky
      // app header so the panel top isn't hidden under it. (issue #69 — summary bullets as a ToC.)
      extra={
        (extra || tooltip || extraEndpoint || (legend && legend.length > 0))
          ? (
            <>
              {legend && legend.length > 0 && (
                <div className={styles.legend}>
                  {legend.map((entry, index) => (
                    <span className={styles.legendItem} key={`${uid}-legend-${index}`}>
                      <span className={styles.legendSwatch} style={{ background: getColorCode(entry.color) }} />
                      {entry.label}
                    </span>
                  ))}
                </div>
              )}
              {extra && renderExtraValue()}
              {/* #83 §0.7: a real widget (e.g. a Button) in the header top-right, with its own action. */}
              {extraEndpoint && <WidgetRenderer widgetEndpoint={extraEndpoint} />}
              {tooltip && (
                <Tooltip title={tooltip}>
                  <Button icon={<FontAwesomeIcon icon={['fas', 'circle-question'] as IconProp} />} type='text' />
                </Tooltip>
              )}
            </>
          )
          : undefined
      }
      id={anchorId ?? undefined}
      key={uid}
      loading={isActionLoading}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={onKeyDown}
      role={isClickable ? 'button' : undefined}
      size={size}
      style={anchorId ? { scrollMarginTop: 80 } : undefined}
      tabIndex={isClickable ? 0 : undefined}
      title={
        title
          ? (
            <div className={`${styles.title} ${titleVariant === 'eyebrow' ? styles.eyebrow : ''}`}>
              <div className={styles.text}>
                <Tooltip title={title}>
                  {title}
                </Tooltip>
              </div>
              {live && <Badge className={styles.liveBadge} status='processing' text='Live' />}
            </div>
          )
          : undefined
      }
      variant={variant}
    >
      {icon && (
        <span
          className={styles.iconFloat}
          style={{ backgroundColor: `color-mix(in srgb, ${getColorCode(icon.color)} 14%, var(--light-color))`, color: getColorCode(icon.color) }}
        >
          <FontAwesomeIcon icon={resolveFaIcon(icon.name)} />
        </span>
      )}
      <div className={styles.content}>
        {headerLeft && panelHeader}
        <div className={`${styles.body} ${icon && !headerLeft ? styles.clearsIcon : ''}`}>
          {items
            .map(({ resourceRefId }, index) => {
              const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)
              if (!endpoint) {
                return null
              }

              return <WidgetRenderer key={`${uid}-${index}`} widgetEndpoint={endpoint} />
            })
            .filter(Boolean)}
        </div>
        {footer && panelFooter}
      </div>
    </AntdCard>
  )
}

export default Card
