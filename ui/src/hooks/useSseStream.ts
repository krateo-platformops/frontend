import { useEffect, useState } from 'react'

import { useConfigContext } from '../context/ConfigContext'
import { useWidgetTransport } from '../transport/widgetTransport'

/**
 * Generic Server-Sent-Events stream: subscribes to `topic` at `endpoint`
 * (resolved under `EVENTS_PUSH_API_BASE_URL`) and prepends each parsed message
 * to a capped buffer. Decoupled from any item shape — the data source concern,
 * separate from presentation (ListView) and domain mapping (itemTemplate).
 *
 * The stream is a signed-in channel: the shared SSE client authenticates with the session's bearer,
 * and it is reached only through the session on the widget transport. A public page's anonymous
 * transport has no session, so there the stream is simply not opened and the list keeps `initial`.
 */
export const useSseStream = <T >({ endpoint, initial, max = 200, topic }: {
  endpoint?: string
  topic?: string
  initial: T[]
  max?: number
}): { connecting: boolean; items: T[] } => {
  const { config } = useConfigContext()
  const subscribeSse = useWidgetTransport().session?.subscribeSse
  const [items, setItems] = useState<T[]>(initial)
  const [connecting, setConnecting] = useState<boolean>(!!endpoint && !!topic)

  useEffect(() => {
    if (!endpoint || !topic || !subscribeSse) {
      setConnecting(false)
      return
    }

    const url = `${config!.api.EVENTS_PUSH_API_BASE_URL}${endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint}`
    const timeout = setTimeout(() => setConnecting(false), 10000)

    // Subscribe through the shared SSE client: one connection per url, shared with
    // Notifications / other streams on the same endpoint instead of a socket each.
    const unsubscribe = subscribeSse(url, topic, {
      onError: () => { setConnecting(false) },
      onMessage: (raw) => {
        try {
          const data = JSON.parse(raw) as T
          setItems((prev) => [data, ...prev].slice(0, max))
          setConnecting(false)
        } catch (error) {
          console.error('Error parsing SSE data:', error)
        }
      },
    })

    return () => {
      unsubscribe()
      clearTimeout(timeout)
    }
  }, [config, endpoint, topic, max, subscribeSse])

  return { connecting, items }
}
