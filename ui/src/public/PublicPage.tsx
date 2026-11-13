/**
 * A PUBLIC PAGE: a portal page opened by someone who is not signed in — or who is, and sees it
 * exactly as anyone else would.
 *
 * WHICH PAGE. `/public/:slug` opens `flexes/page-<slug>` in the PUBLIC-PAGES namespace,
 * `config.params.PUBLIC_NAMESPACE` (the chart's `publicNamespace`, by convention `krateo-public`: an
 * isolated namespace whose only Role is the public identity's), and `/public/:namespace/:slug`
 * opens it in that namespace. Never in the frontend's own namespace (FRONTEND_NAMESPACE, where the
 * signed-in portal's pages live): see PublicRoute. It is the same `page-<slug>` convention the
 * navigation resolves (widgets/Menu/navModel.ts), so nothing here lists pages, and nothing about any
 * particular page lives in the frontend. Whether a page IS public is not the frontend's to say:
 * snowplow serves a request with no Authorization header as `krateo:public`, and its answer is the
 * authority (snowplow#1334). A page is public when its widgets are granted to that identity — the
 * grant ships with the page, so a page set makes itself public on its own.
 *
 * WHAT IS RENDERED. Only what the anonymous read got a 200 for. A 401 on any read means this
 * installation serves no public pages (one page-level state, P1); a 403 or 404 on the root means
 * this page is not shared (P2); a 503 on the root means the public identity is temporarily
 * unavailable, for example mid-roll (P3, with a Retry that reads the root again). On a child, a 403
 * is that child's own WidgetForbidden and a 503 its own WidgetTimeout (with its own Retry), in
 * place: the rest of the page was read, so one part that could not be is not the whole page's
 * state. Never the signed-in shell, never a sign-in prompt, never a redirect.
 *
 * HOW IT STAYS ANONYMOUS. It is a route of its own OUTSIDE the signed-in shell (context/
 * RoutesProvider.tsx), so the signed-in transport is never above it and every read, from the root
 * down, goes through the anonymous transport (public/anonymousTransport.ts), which has no way to
 * reach the stored token. It also reads through its OWN query cache, so nothing the signed-in
 * portal cached in this tab — read with a token, possibly showing more — can be served here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router'

import WidgetRenderer from '../components/WidgetRenderer'
import { PublicPageNotShared, PublicPageUnavailable, PublicServingOff } from '../components/WidgetStates'
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

/** The root endpoint for `page-<slug>` in `namespace`, or null when the two cannot name a page. */
export const publicPageEndpoint = (slug: string | undefined, namespace: string | undefined): string | null => {
  if (!slug || !SLUG.test(slug) || !namespace || !NAMESPACE.test(namespace)) { return null }
  return getResourceEndpoint({ apiVersion: PAGE_API_VERSION, name: `page-${slug}`, namespace, resource: PAGE_RESOURCE })
}

type PublicState = 'page' | 'serving-off' | 'not-shared' | 'unavailable'

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
    // snowplow cannot serve the public identity right now (snowplow#1334: its grant is missing, for
    // example mid-roll). Transient, and not a sign-in problem. Reached only after the widget
    // query's own retries (hooks/useWidgetQuery.ts), which a 503 gets.
    if (status === 503) { setState('unavailable') }
  }

  // The root's renderer is unmounted while P3 shows. Resetting the cache puts its query back to
  // pending, so the renderer mounts to its skeleton and reads the root again, rather than showing
  // the 503 it remembers.
  const retry = () => {
    void queryClient.resetQueries()
    setState('page')
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WidgetTransportProvider value={transport}>
        <WidgetScopeProvider scope='page'>
          <main className={styles.page}>
            {/* P3 sits INSIDE the PageRoot, unlike P1 and P2, which replace the page. The PageRoot
                holds the fragment captured when the page opened, and the failed root has already
                cleared it from the address bar, so a Retry that remounted the PageRoot would read
                the page without the link's inputs. */}
            <PageRootProvider endpoint={endpoint} onFailed={onRootFailed}>
              {state === 'unavailable'
                ? <PublicPageUnavailable onRetry={retry} />
                : <WidgetRenderer widgetEndpoint={endpoint} />}
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

/** What a short address says when the config names no public-pages namespace. */
export const NO_PUBLIC_NAMESPACE = "This installation has no namespace set for public pages (PUBLIC_NAMESPACE), so a short address like this one can't open one."

/**
 * The route element: the address → the page root, one PublicPage per address.
 *
 * A short address reads in PUBLIC_NAMESPACE, and when the config has none (a chart older than the
 * key, under a newer image) it opens nothing and says why. It deliberately does NOT fall back to
 * FRONTEND_NAMESPACE: that is the frontend's own namespace, krateo-system, so a fallback would
 * read pages from krateo-system as the public identity, and make any grant to krateo:public there
 * a public page. The public-pages namespace exists so that krateo:public's grants live in a
 * namespace of their own rather than as resourceNames grants in krateo-system.
 */
export const PublicRoute = () => {
  const { namespace, slug } = useParams()
  const { config } = useConfigContext()
  const publicNamespace = config?.params.PUBLIC_NAMESPACE
  if (namespace === undefined && !publicNamespace) {
    return <main className={styles.page}><PublicPageNotShared subtitle={NO_PUBLIC_NAMESPACE} /></main>
  }
  const endpoint = publicPageEndpoint(slug, namespace ?? publicNamespace)
  return <PublicPage endpoint={endpoint} key={`${namespace ?? ''}/${slug ?? ''}`} />
}

export default PublicRoute
