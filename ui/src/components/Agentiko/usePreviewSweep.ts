/**
 * Removes the author's own abandoned previews when they visit a builder (previewSweep.ts): once per
 * document, and only where a preview sandbox is configured. No router here: the shell says when a
 * builder's page was visited (builders/builderVisit.ts).
 */
import { useEffect, useSyncExternalStore } from 'react'

import { hasVisitedBuilder, subscribeBuilderVisit } from '../../builders/builderVisit'
import type { Config } from '../../context/ConfigContext'
import { useWidgetTransport } from '../../transport/widgetTransport'

import type { SandboxWriter } from './blueprintRenderSandbox'
import { startPreviewSweep } from './previewSweep'

export const usePreviewSweep = (heldPage: () => string | undefined, config: Config | undefined, writer: SandboxWriter | undefined): void => {
  const visited = useSyncExternalStore(subscribeBuilderVisit, hasVisitedBuilder)
  const { fetch } = useWidgetTransport()
  const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
  useEffect(() => {
    if (writer && snowplowBaseUrl && visited) { startPreviewSweep({ fetch, heldPage, snowplowBaseUrl, writer }) }
  }, [fetch, heldPage, snowplowBaseUrl, visited, writer])
}
