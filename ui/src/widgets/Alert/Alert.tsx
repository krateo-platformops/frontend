import { Alert as AntdAlert } from 'antd'

import { withTimeTokens } from '../../components/TimeText/withTimeTokens'
import type { WidgetProps } from '../../types/Widget'

import type { Alert as WidgetType } from './Alert.type'

export type AlertWidgetData = WidgetType['spec']['widgetData']

// `title` and `description` may carry time tokens ({ago:<ISO>}…, components/TimeText/withTimeTokens), written
// in the browser in the viewer's zone. Text without one is passed through as the same string.
const Alert = ({ uid, widgetData: { description, title, ...rest } }: WidgetProps<AlertWidgetData>) => {
  return <AntdAlert key={uid} {...rest} description={withTimeTokens(description)} title={withTimeTokens(title)} />
}

export default Alert
