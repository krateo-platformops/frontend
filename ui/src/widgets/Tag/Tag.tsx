import StatusPill from '../../components/StatusPill'
import { withTimeTokens } from '../../components/TimeText/withTimeTokens'
import type { WidgetProps } from '../../types/Widget'

import type { Tag as WidgetType } from './Tag.type'

export type TagWidgetData = WidgetType['spec']['widgetData']

const Tag = ({ uid, widgetData }: WidgetProps<TagWidgetData>) => {
  // Strip the antd `color` preset and resolve it to the EXACT Petrol hex as a soft-tint pill (so
  // a "green"/"gold"/"violet" status Tag is Petrol cyan/amber/magenta, not antd's built-in ones).
  // The CR's inline `style` MERGES over the palette tint rather than replacing it, so a Tag can
  // set both a colour AND its own font/size — the dashboard delta pills need exactly that.
  //
  // The pill itself — tint, leading status dot, and the rules about when that dot appears — lives
  // in StatusPill, because PageHeader draws the same pill from its native `tags` array and the
  // two must not drift.
  const { color, label, style, ...rest } = widgetData

  // A time token in the label ({ago:<ISO>}…) is written in the browser (components/TimeText/withTimeTokens);
  // a label without one is the same string, so its state glyph (stateFamily) reads exactly as before.
  return <StatusPill {...rest} color={color} key={uid} label={withTimeTokens(label)} style={style} />
}

export default Tag
