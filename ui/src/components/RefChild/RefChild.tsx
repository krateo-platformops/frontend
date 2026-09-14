import { WarningOutlined } from '@ant-design/icons'
import { Result, Tooltip, Typography } from 'antd'

import type { ResourcesRefs } from '../../types/Widget'
import { getEndpointUrl } from '../../utils/utils'
import WidgetRenderer from '../WidgetRenderer'

/**
 * X4 — one visible result for one authoring mistake, in every container.
 *
 * A `resourceRefId` with no matching `resourcesRefs` entry used to behave four different ways
 * depending purely on which container it sat in: Row/Col/Flex/Card dropped the child silently,
 * Table rendered a dash indistinguishable from an empty value, PageHeader logged a bespoke error,
 * and only Tabs told the author what was wrong. This is Tabs' behaviour, lifted.
 *
 * THE PART THAT IS NOT COSMETIC — why `deniedRefIds` exists:
 *
 * `WidgetRenderer` filters `allowed: false` refs out of the list before any container sees it, so
 * at this layer an RBAC-DENIED child is byte-identical to a typo'd one. Rendering a loud error for
 * every unresolvable ref would therefore announce the existence of resources outside the caller's
 * scope on every partially-permitted page — exactly the leak X2 decided against, where a denial
 * reading as absence is the deliberate position.
 *
 * So the denied ids are passed down ALONGSIDE the filtered list, and a denied ref still renders as
 * nothing. That filter cannot simply be removed instead: `navModel.isNavEntryAllowed` decides nav
 * visibility by presence in the filtered list, so un-filtering would make every denied nav entry
 * appear. This is additive for that reason.
 */
export type RefChildProps = {
  /** Ids the RBAC filter removed. A ref listed here renders as nothing — never as an error. */
  deniedRefIds?: string[]
  /**
   * `block` renders the full Result (a tab, a page section, a card body).
   * `inline` renders a compact marker — a Result inside a table cell would destroy row height.
   */
  density?: 'block' | 'inline'
  /** What the author called this slot, e.g. 'tab' or 'column'. Names the thing that failed. */
  label?: string
  resourceRefId: string
  resourcesRefs: ResourcesRefs
}

/**
 * What `RefChild` would render, without rendering it.
 *
 * Row needs this: a DANGLING ref must keep its `AntdColumn` wrapper so the grid does not reflow
 * around the error, but a DENIED ref must drop the whole column exactly as it does today — an
 * empty column of the same span would both look broken and hint that something was removed, which
 * is the leak X2 rules out.
 */
export const refChildState = (
  resourceRefId: string,
  resourcesRefs: ResourcesRefs,
  deniedRefIds?: string[],
): 'dangling' | 'denied' | 'ok' => {
  if (getEndpointUrl(resourceRefId, resourcesRefs)) { return 'ok' }
  return deniedRefIds?.includes(resourceRefId) ? 'denied' : 'dangling'
}

const RefChild = ({ deniedRefIds, density = 'block', label = 'widget', resourceRefId, resourcesRefs }: RefChildProps) => {
  const endpoint = getEndpointUrl(resourceRefId, resourcesRefs)

  if (endpoint) {
    return <WidgetRenderer widgetEndpoint={endpoint} />
  }

  // X2: a denial reads as absence. Deliberately indistinguishable from the ref never existing.
  if (deniedRefIds?.includes(resourceRefId)) {
    return null
  }

  const message = `The ${label} references an invalid resource with resourceRefId: ${resourceRefId}`

  if (density === 'inline') {
    return (
      <Tooltip title={message}>
        <Typography.Text type='danger'><WarningOutlined /></Typography.Text>
      </Tooltip>
    )
  }

  return <Result status='error' subTitle={message} title={`Error while rendering ${label}`} />
}

export default RefChild
