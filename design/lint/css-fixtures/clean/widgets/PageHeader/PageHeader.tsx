import { Flex, Typography } from 'antd'

// The false-positive case that matters: a COMPOSITE. antd has no PageHeader, so this widget
// legitimately self-styles and must never be reported as missing a buildComponents entry.
export const PageHeader = () => <Flex><Typography.Title>x</Typography.Title></Flex>
