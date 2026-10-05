// Wraps antd's Row, which has nothing to theme — a documented opt-out must keep T2 silent.
// T2 opt-out: antd's Grid exposes no component tokens; the gutter is a prop
import { Row as AntdRow } from 'antd'

export const Row = () => <AntdRow />
