/**
 * Removes the author's own abandoned previews when they visit a builder (previewSweep.ts): once per
 * document, and only where a preview sandbox is configured.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router'

import { isBuilderPath } from '../../builders/builderRegistry'
import type { Config } from '../../context/ConfigContext'

import type { SandboxWriter } from './blueprintRenderSandbox'
import { startPreviewSweep } from './previewSweep'

export const usePreviewSweep = (heldPage: () => string | undefined, config: Config | undefined, writer: SandboxWriter | undefined): void => {
  const { pathname } = useLocation()
  const snowplowBaseUrl = config?.api.SNOWPLOW_API_BASE_URL
  const onBuilder = isBuilderPath(pathname)
  useEffect(() => {
    if (writer && snowplowBaseUrl && onBuilder) { startPreviewSweep({ heldPage, snowplowBaseUrl, writer }) }
  }, [heldPage, onBuilder, snowplowBaseUrl, writer])
}
