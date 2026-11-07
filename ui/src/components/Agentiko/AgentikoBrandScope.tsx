import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'

import { useThemeModeOrLight } from '../../context/ThemeModeContext'
import { agentikoAntdTheme } from '../../theme/tokens'

/**
 * The agent wears Agentiko's coordinated image inside Krateo, and only the agent does (see
 * `agentikoBrand` in theme/tokens.ts). This nests an antd ConfigProvider whose theme merges onto
 * the root one, so the antd buttons, links and focus rings INSIDE an agent surface take the
 * Agentiko violet while everything outside keeps the Krateo primary. The module CSS of the same
 * surfaces re-points `--primary-color` for their own rules; this covers what antd draws itself.
 *
 * Portalled antd overlays opened from inside (a Popconfirm, a Modal) inherit it too: ConfigProvider
 * is React context, not DOM.
 */
const AgentikoBrandScope = ({ children }: { children: ReactNode }) => {
  const mode = useThemeModeOrLight()

  return <ConfigProvider theme={agentikoAntdTheme(mode)}>{children}</ConfigProvider>
}

export default AgentikoBrandScope
