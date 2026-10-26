export interface Timeline {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Timeline displays a vertical (or horizontal) sequence of events in chronological order
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties Timeline renders. Where Timeline wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry.
       */
      allowedResources?: string[]
      /**
       * the timeline nodes, in display order (antd Timeline `items`)
       */
      items: {
        /**
         * the label on the opposite side of the rail, e.g. a timestamp (antd item `title`, formerly `label`)
         */
        title?: string
        /**
         * the body of the node, e.g. the event reason and message (antd item `content`, formerly `children`)
         */
        content?: string
        /**
         * the dot color: an antd preset (`blue`, `red`, `green`, `gray`) or any CSS color
         */
        color?: string
        /**
         * a font awesome icon name rendered instead of the dot (eg: `fa-check`) (antd item `icon`, formerly `dot`)
         */
        icon?: string
        /**
         * which side of the rail the content sits on when `mode` is `alternate` (antd item `placement`, formerly `position`)
         */
        placement?: 'start' | 'end'
        /**
         * render this node as in-progress (a spinning dot). Replaces antd's deprecated `pending` prop
         */
        loading?: boolean
        /**
         * optional id of a widget to render inline below this node's content (e.g. a button opening the event's object)
         */
        resourceRefId?: string
      }[]
      /**
       * where the content sits relative to the rail (antd Timeline `mode`)
       */
      mode?: 'start' | 'end' | 'alternate'
      /**
       * the layout orientation of the timeline (antd Timeline `orientation`)
       */
      orientation?: 'vertical' | 'horizontal'
      /**
       * render the items in reverse order
       */
      reverse?: boolean
      /**
       * how much of the row the `title` column takes: a 24-grid span (eg: `6`) or a CSS length (eg: `120px`) (antd Timeline `titleSpan`)
       */
      titleSpan?: number | string
      /**
       * the dot style (antd Timeline `variant`)
       */
      variant?: 'outlined' | 'filled'
      /**
       * live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget.
       */
      watch?: {
        /**
         * group/version, e.g. composition.krateo.io/v1alpha1
         */
        apiVersion: string
        /**
         * e.g. DemoClaim
         */
        kind: string
        /**
         * scope to a namespace; omit to match any
         */
        namespace?: string
        /**
         * a specific object; omit to match any object of this kind ("GVR-level")
         */
        name?: string
      }[]
    }
    /**
     * Binds this widget to a RESTAction whose response feeds the widgetDataTemplate and resourcesRefsTemplate expressions. Omit it for a widget whose data is entirely static.
     */
    apiRef?: {
      /**
       * Name of the RESTAction resource to call.
       */
      name: string
      /**
       * Namespace of the RESTAction resource.
       */
      namespace: string
    }
    /**
     * Per-field overrides evaluated against the apiRef response, so one authored widget can render live cluster data. Each entry replaces one value inside widgetData.
     */
    widgetDataTemplate?: {
      /**
       * Dot-path inside widgetData whose value this expression replaces, for example `items[0].title`.
       */
      forPath?: string
      /**
       * A jq expression evaluated server-side against the apiRef response. Its result replaces the value at forPath.
       */
      expression?: string
    }[]
    /**
     * The resources this widget references by id. Each entry is resolved server-side and its endpoint handed to the widget; entries the caller may not read are removed before the widget renders, so a denied reference reads as absence rather than as an error.
     */
    resourcesRefs?: {
      /**
       * One referenced resource. The widget addresses it by its `id`, never by name.
       */
      items: {
        /**
         * Set server-side: whether the caller may perform this verb. False entries are stripped before the widget renders and are never authored by hand.
         */
        allowed?: boolean
        /**
         * Group and version of the referenced resource, for example `widgets.templates.krateo.io/v1beta1`.
         */
        apiVersion?: string
        /**
         * The author-chosen handle this widget uses to reference the resource, matching a resourceRefId in widgetData.
         */
        id: string
        /**
         * Name of the referenced resource.
         */
        name?: string
        /**
         * Namespace of the referenced resource.
         */
        namespace?: string
        /**
         * Body sent with a mutating verb. Ignored for a GET.
         */
        payload?: {
          [k: string]: unknown
        }
        /**
         * Plural resource name, for example `paragraphs`.
         */
        resource?: string
        /**
         * HTTP verb used to resolve the reference. GET for a read; a mutating verb makes this a write the widget can dispatch.
         */
        verb?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
        /**
         * Server-side paging for this reference: the widget receives one page rather than the whole list.
         */
        slice?: {
          /**
           * Number of items to skip before the returned page.
           */
          offset?: number
          /**
           * One-based page number to return.
           */
          page: number
          /**
           * Maximum items in the returned page.
           */
          perPage: number
          /**
           * Opaque continuation token from a previous response, used to fetch the next page.
           */
          continue?: boolean
          [k: string]: unknown
        }
        [k: string]: unknown
      }[]
      [k: string]: unknown
    }
    /**
     * Generates resourcesRefs entries from the apiRef response — one per element the iterator yields — so a widget can reference a list whose length it does not know when authored.
     */
    resourcesRefsTemplate?: {
      /**
       * A jq expression selecting the array in the apiRef response to iterate over.
       */
      iterator?: string
      /**
       * The resourcesRefs entry emitted for each iterated element; its fields may interpolate that element.
       */
      template?: {
        /**
         * Group and version of the referenced resource, for example `widgets.templates.krateo.io/v1beta1`.
         */
        apiVersion?: string
        /**
         * The author-chosen handle this widget uses to reference the resource, matching a resourceRefId in widgetData.
         */
        id?: string
        /**
         * Name of the referenced resource.
         */
        name?: string
        /**
         * Namespace of the referenced resource.
         */
        namespace?: string
        /**
         * Body sent with a mutating verb. Ignored for a GET.
         */
        payload?: {
          [k: string]: unknown
        }
        /**
         * Plural resource name, for example `paragraphs`.
         */
        resource?: string
        /**
         * HTTP verb used to resolve the reference. GET for a read; a mutating verb makes this a write the widget can dispatch.
         */
        verb?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
      }
    }[]
  }
}
