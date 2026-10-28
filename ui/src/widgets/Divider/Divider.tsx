import { Divider as AntdDivider } from 'antd'

import type { WidgetProps } from '../../types/Widget'

import type { Divider as WidgetType } from './Divider.type'

export type DividerWidgetData = WidgetType['spec']['widgetData']

const Divider = ({ uid, widgetData }: WidgetProps<DividerWidgetData>) => {
  // The plain divider has nothing to say: its own example CR leaves `widgetData:` empty, which YAML
  // reads as null and the apiserver drops. Destructuring that threw, so the documented example was a
  // render error. Found by the visual-regression harness, which renders every widget's example.
  const { label, ...rest } = widgetData ?? {}

  return <AntdDivider key={uid} {...rest}>{label}</AntdDivider>
}

export default Divider
