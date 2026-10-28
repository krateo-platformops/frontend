// T2 opt-out: antd's QRCode exposes no component tokens to theme; size and colour are props
import { QRCode as AntdQRCode } from 'antd'

import type { WidgetProps } from '../../types/Widget'

import type { QRCode as WidgetType } from './QRCode.type'

export type QRCodeWidgetData = WidgetType['spec']['widgetData']

const QRCode = ({ uid, widgetData }: WidgetProps<QRCodeWidgetData>) => {
  return <AntdQRCode key={uid} {...widgetData} />
}

export default QRCode
