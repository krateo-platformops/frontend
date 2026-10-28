import type { QueryKey } from '@tanstack/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { useConfigContext } from '../context/ConfigContext'
import { getAccessToken } from '../utils/getAccessToken'
import type { SSEK8sEvent } from '../utils/types'

import { type EventScope, subscribeSse } from './sseClient'

const MAX_EVENTS = 200
// 10 seconds
const CLEANUP_INTERVAL = 10000

export function useGetEvents({ registerToSSE = true, topic = 'krateo' }: { topic?: string; registerToSSE?: boolean }) {
  const { config } = useConfigContext()

  // list of events
  const eventsUrl = `${config!.api.EVENTS_API_BASE_URL}/events`

  // stream of events
  const notificationsUrl = `${config!.api.EVENTS_PUSH_API_BASE_URL}/notifications`

  const queryKey: QueryKey = useMemo(() => ['events', eventsUrl, 'topic', topic], [eventsUrl, topic])

  const queryClient = useQueryClient()
  // The scope the proxy announced on the LAST successful open. Not "the scope": a stream that has
  // dropped leaves this stale by definition, which is why the drawer pairs it with the fact that
  // nothing is connected rather than rendering it alone.
  const [scope, setScope] = useState<EventScope>({ kind: 'unscoped' })
  const queryResult = useQuery({
    gcTime: Infinity,
    queryFn: async () => {
      // sse-proxy verifies the caller's JWT (RS256/JWKS) on /events; forward it
      // as a Bearer header exactly like every other backend call.
      const res = await fetch(eventsUrl, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      })
      const notifications = (await res.json()) as SSEK8sEvent[]
      return notifications
    },

    queryKey,
    /* Prevent all automatic refetching, SSE will handle new events  */
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  // Cleanup old events periodically to prevent memory issues
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.setQueryData(queryKey, (prev: SSEK8sEvent[]) => {
        if (!prev || prev.length <= MAX_EVENTS) {
          return prev
        }
        return prev.slice(0, MAX_EVENTS)
      })
    }, CLEANUP_INTERVAL)

    return () => clearInterval(interval)
  }, [queryClient, queryKey])

  useEffect(() => {
    if (!registerToSSE) {
      return
    }

    // Subscribe through the shared SSE client so we don't open a second connection to
    // /notifications when other widgets (List/Listy) listen to the same stream.
    // The URL carries NO credential: sseClient authenticates with `Authorization: Bearer`
    // (installer#395 — the token used to ride as ?access_token= and reach the access logs).
    return subscribeSse(notificationsUrl, topic, {
      onError: () => { console.error('[SSE] Connection error') },
      onMessage: (raw) => {
        try {
          const data = JSON.parse(raw) as SSEK8sEvent
          queryClient.setQueryData(queryKey, (prev: SSEK8sEvent[]) => [data, ...(prev || [])])
        } catch (error) {
          console.error('Error parsing event data:', error)
        }
      },
      onOpen: ({ reopened, scope: announced }) => {
        setScope(announced)
        // A REOPEN has a hole in it. sse-proxy keeps no replay and sends no ids, so every event
        // published while the stream was down is simply gone — and this list is append-only from
        // the stream's side, so the hole would sit in the bell until a reload. Refetch the
        // baseline instead; GET /events is the only thing that can fill it.
        //
        // Guarded on `reopened` because the FIRST open happens next to this hook's own useQuery:
        // invalidating there would refetch the list we are already fetching, on every mount.
        if (reopened) {
          void queryClient.invalidateQueries({ queryKey })
        }
      },
    })
  }, [notificationsUrl, topic, queryClient, queryKey, registerToSSE])

  // Deliberately NOT `{ ...queryResult, scope }`: spreading a react-query result makes the
  // consumer observe every field of the query and re-render on all of them
  // (@tanstack/query/no-rest-destructuring). These three are what the bell actually reads.
  return { data: queryResult.data, isLoading: queryResult.isLoading, scope }
}
