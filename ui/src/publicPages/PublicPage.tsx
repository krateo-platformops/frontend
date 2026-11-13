/**
 * A PUBLIC PAGE: a portal page opened by someone who is not signed in — or who is, and sees it
 * exactly as anyone else would.
 *
 * WHICH PAGE. `/public/:slug` opens `flexes/page-<slug>` in the frontend's namespace, and
 * `/public/:namespace/:slug` opens it in that namespace: the same `page-<slug>` convention the
 * navigation resolves (widgets/Menu/navModel.ts), so nothing here lists pages, and nothing about any
 * particular page lives in the frontend. Whether a page IS public is not the frontend's to say:
 * snowplow serves a request with no Authorization header as `krateo:public`, and its answer is the
 * authority (snowplow#1334). A page is public when its widgets are granted to that identity — the
 * grant ships with the page, so a page set makes itself public on its own.
 *
 * WHAT IS RENDERED. Only what the anonymous read got a 200 for. A 401 on any read means this
 * installation serves no public pages (one page-level state, P1); a 403 or 404 on the root means
 * this page is not shared (P2); a 403 on a child is that child's own WidgetForbidden, in place.
 * Never the signed-in shell, never a sign-in prompt, never a redirect.
 *
 * HOW IT STAYS ANONYMOUS. It is a route of its own OUTSIDE the signed-in shell (context/
 * RoutesContext.tsx), so the signed-in transport is never above it and every read, from the root
 * down, goes through the anonymous transport (publicPages/anonymousTransport.ts), which has no way to
 * reach the stored token. It also reads through its OWN query cache, so nothing the signed-in
 * portal cached in this tab — read with a token, possibly showing more — can be served here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router'

import WidgetRenderer from '../components/WidgetRenderer'
import { PublicPageNotShared, PublicServingOff } from '../components/WidgetStates'
import { useConfigContext } from '../context/ConfigContext'
import { PageRootProvider } from '../context/PageRootContext'
import { WidgetScopeProvider } from '../context/WidgetScopeContext'
import { WidgetTransportProvider } from '../transport/widgetTransport'
import { getResourceEndpoint } from '../utils/utils'
import Drawer from '../widgets/Drawer'
import Modal from '../widgets/Modal'

import { createAnonymousTransport, parsePublicPostPaths } from './anonymousTransport'
import styles from './PublicPage.module.css'

/** The routes a public page answers at — outside the shell, next to /login. */
export const PUBLIC_ROUTE_PATHS = ['/public/:slug', '/public/:namespace/:slug'] as const

/** Whether a path is in the public space, which no shell route (nav or Builder) may take. */
export const isPublicPath = (path: string | undefined): boolean => !!path && (path === '/public' || path.startsWith('/public/'))

const PAGE_RESOURCE = 'flexes'
const PAGE_API_VERSION = 'widgets.templates.krateo.io/v1beta1'

/** A Kubernetes namespace: a DNS-1123 label. */
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/
/** A slug that makes a valid `page-<slug>` object name. */
const SLUG = /^[a-z0-9]([-a-z0-9.]{0,240}[a-z0-9])?$/

/** The root endpoint for a public address, or null when the address cannot name a page. */
export const publicPageEndpoint = (slug: string | undefined, namespace: string | undefined, defaultNamespace: string): string | null => {
  const ns = namespace ?? defaultNamespace
  if (!slug || !SLUG.test(slug) || !NAMESPACE.test(ns)) { return null }
  return getResourceEndpoint({ apiVersion: PAGE_API_VERSION, name: `page-${slug}`, namespace: ns, resource: PAGE_RESOURCE })
}

type PublicState = 'page' | 'serving-off' | 'not-shared'

/** Same defaults as the app's client (App.tsx), but a separate cache. */
const createPublicQueryClient = () => new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, staleTime: 30 * 1000 } },
})

export const PublicPage = ({ endpoint }: { endpoint: string | null }) => {
  const { config } = useConfigContext()
  const [queryClient] = useState(createPublicQueryClient)
  const [state, setState] = useState<PublicState>(endpoint ? 'page' : 'not-shared')
  const allowlist = config?.api.PUBLIC_POST_PATHS
  const transport = useMemo(() => createAnonymousTransport({
    // A 401 is the installation's answer, not this page's: it serves no public identity at all.
    onUnauthorized: () => { setState('serving-off') },
    postAllowlist: parsePublicPostPaths(allowlist),
  }), [allowlist])

  if (state === 'serving-off') { return <main className={styles.page}><PublicServingOff /></main> }
  if (state === 'not-shared' || !endpoint) { return <main className={styles.page}><PublicPageNotShared /></main> }

  const onRootFailed = (status: number | undefined) => {
    if (status === 401) { setState('serving-off') }
    if (status === 403 || status === 404) { setState('not-shared') }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WidgetTransportProvider value={transport}>
        <WidgetScopeProvider scope='page'>
          <main className={styles.page}>
            <PageRootProvider endpoint={endpoint} onFailed={onRootFailed}>
              <WidgetRenderer widgetEndpoint={endpoint} />
            </PageRootProvider>
          </main>
          {/* The page's own overlays: an openDrawer/openModal action on a public page opens here,
              under the same anonymous transport. */}
          <Drawer />
          <Modal />
        </WidgetScopeProvider>
      </WidgetTransportProvider>
    </QueryClientProvider>
  )
}

/** The route element: the address → the page root, one PublicPage per address. */
export const PublicRoute = () => {
  const { namespace, slug } = useParams()
  const { config } = useConfigContext()
  const endpoint = publicPageEndpoint(slug, namespace, config?.params.FRONTEND_NAMESPACE ?? '')
  return <PublicPage endpoint={endpoint} key={`${namespace ?? ''}/${slug ?? ''}`} />
}

export default PublicRoute
