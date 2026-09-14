import type { WidgetActions } from './actions.generated'

export interface ResourceRef {
  allowed: boolean
  id: string
  path: string
  verb: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT'
  payload: object
}

export type ResourcesRefs = {
  items: ResourceRef[]
  slice?: {
    page: number
    perPage: number
    continue: boolean
  }
}

export interface Widget<WidgetDataType = unknown> {
  apiVersion: string
  kind: string
  code?: number
  message?: string
  reason?: string
  metadata: {
    annotations: object
    creationTimestamp: string
    generation: number
    name: string
    namespace: string
    resourceVersion: string
    uid: string
  }
  spec: {
    actions: WidgetActions
    widgetData: WidgetDataType
    resourcesRefs: ResourcesRefs
    /**
     * Opt-in staleness indicator: when true the widget shows the stale/refreshing
     * dot overlay (exception states only). Absent/false = no badge ever (the
     * default; healthy widgets stay unmarked).
     */
    freshness?: boolean
  }
  status:
    | {
        actions: WidgetActions
        widgetData: WidgetDataType
        resourcesRefs?: ResourcesRefs
      }
    | string
}

// WidgetActions is GENERATED from the canonical fragment src/schemas/actions.schema.json
// (the single source of truth) by `npm run generate-types`. Do not hand-edit the shape —
// edit the fragment and regenerate. validate-schemas enforces that every widget's
// widgetData.actions copies that fragment verbatim, so the schema and this type can't drift.
export type { WidgetActions }

type RestAction = NonNullable<WidgetActions['rest']>[number]
type NavigateAction = NonNullable<WidgetActions['navigate']>[number]
type OpenDrawerAction = NonNullable<WidgetActions['openDrawer']>[number]
type OpenModalAction = NonNullable<WidgetActions['openModal']>[number]

export type WidgetAction = RestAction | NavigateAction | OpenDrawerAction | OpenModalAction

/**
 * Classic server-side pager controls, produced by `useWidgetQuery` for widgets
 * that opt into bounded pagination (see `PAGINATED_RESOURCE_PAGE_SIZE`) and passed
 * down to the widget so its pager can jump pages WITHOUT accumulating the whole
 * dataset. `page` is 1-based; `setPage` re-keys the query to fetch that page only;
 * `pageSize` is the per-page window the request used. Undefined for non-paged widgets.
 */
export type ServerPagination = {
  page: number
  pageSize: number
  setPage: (page: number) => void
}

export type WidgetProps<T = unknown> = {
  /**
   * X4/X2 — ids the RBAC filter removed from `resourcesRefs.items`. A container uses this to tell
   * a DENIED child (render nothing: a denial reads as absence) from a TYPO'D one (render a visible
   * error). Without it the two are byte-identical once the filter has run.
   */
  deniedRefIds?: string[]
  resourcesRefs: ResourcesRefs
  serverPagination?: ServerPagination
  uid: string
  widgetData: T
  widget?: Widget
}
