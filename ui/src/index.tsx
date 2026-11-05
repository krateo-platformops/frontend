import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App.tsx'
import { ThemeModeProvider } from './context/ThemeModeContext.tsx'
import { tracesEndpointOf, type TelemetryConfig } from './otel/endpoint.ts'

/**
 * Optionally bootstrap browser-side OTel tracing BEFORE React mounts, so the
 * provider + fetch/XHR instrumentation are in place for the very first backend
 * calls. Gated default-OFF: we do a small standalone fetch of the runtime config
 * and only `import()` (and run) the OTel module when a traces endpoint is set.
 * When the key is absent — or the config fetch fails — nothing is loaded and the
 * default runtime path is byte-identical (no provider, no traceparent headers).
 * We never block the app on this: mounting proceeds regardless.
 */
async function bootstrapTracing(): Promise<void> {
  try {
    const res = await fetch('/config/config.json', { cache: 'no-store' })
    if (!res.ok) {
      return
    }
    const cfg = (await res.json()) as { api?: TelemetryConfig }
    if (tracesEndpointOf(cfg?.api)) {
      const { initTracing } = await import('./otel/tracing')
      initTracing(cfg as Parameters<typeof initTracing>[0])
    }
  } catch {
    // Tracing is best-effort observability; never let it break app startup.
  }
}

function mount(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeModeProvider>
        <App />
      </ThemeModeProvider>
    </React.StrictMode>
  )
}

void bootstrapTracing().finally(mount)
