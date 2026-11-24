/**
 * THE PAGE'S ROUTE PARAMS (`/compositions/:namespace/:name`), for every widget in the shell: the page, and the
 * drawers and dialogs opened over it.
 *
 * A drawer or a dialog is mounted once, beside the page, so it outlives navigation. Its widgets are about the
 * page all the same: "Edit values" reads the composition whose address is open. While the pages were children
 * of the shell's route, react-router gave the whole matched branch one params object and this was free. Since
 * 1.8.75 they are descendant routes (RoutesProvider), whose params exist only BELOW the element that serves
 * them, so a drawer's reads carried none, and "Edit values" had nothing to render on every composition.
 *
 * The params are therefore matched once, from the table and the address the pages are served from, and given to
 * the whole shell. Outside it (a public page) the route's own params are the page's.
 */
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { matchRoutes, type RouteObject, useLocation, useParams } from 'react-router'

type PageParams = Readonly<Record<string, string | undefined>>

const PageParamsContext = createContext<PageParams | null>(null)
const NONE: PageParams = Object.freeze({})

/** Matches the address against the routes the pages are served from, for everything inside. */
export const PageParamsProvider = ({ children, routes }: { children: ReactNode; routes: RouteObject[] }) => {
  const { pathname } = useLocation()
  const params = useMemo(() => matchRoutes(routes, pathname)?.at(-1)?.params ?? NONE, [pathname, routes])
  return <PageParamsContext.Provider value={params}>{children}</PageParamsContext.Provider>
}

/** The open page's params, wherever in the shell this is called from. */
export const usePageParams = (): PageParams => {
  const page = useContext(PageParamsContext)
  const matched = useParams()
  return page ?? matched
}
