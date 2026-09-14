import { Alert as AntdAlert } from 'antd'

// Wraps antd's Alert but buildComponents has no Alert entry — density is unthemed. T2 must fire.
export const Alert = () => <AntdAlert message="x" />
