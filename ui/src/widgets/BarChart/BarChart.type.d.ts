export interface BarChart {
  /**
   * Widget API version.
   */
  version: string
  /**
   * BarChart wraps the @ant-design/charts Column component (AntV G2 — vertical bars). It mirrors that library's data + field-mapping API.
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * @ant-design/charts Column config (AntV G2)
     */
    widgetData: {
      /**
       * chart data records (G2 `data`)
       */
      data: {
        [k: string]: unknown
      }[]
      /**
       * field mapped to the category axis (G2 `xField`)
       */
      xField: string
      /**
       * field mapped to the value axis (G2 `yField`)
       */
      yField: string
      /**
       * When set, `xField` values are UNIX epoch SECONDS, one bar per bucket in the order sent, labelled in the VIEWER's time zone as all text is: 'hour' -> the clock ('14:00'), the day named where it changes ('25 Nov', or '25 Nov, 01:00' when the bucket is not at midnight); 'day' -> the day ('24 Nov'; '31 Dec 2025' in another year). The tooltip gives the bar's full date with the zone ('Tue 24 November 2026, 14:00:00 (UTC+1)'). Use this instead of server-side strftime, which is UTC: a chart an hour apart from the text beside it.
       */
      xTimeUnit?: 'hour' | 'day'
      /**
       * The row field that says a slot is not a whole measurement: `partial` for the slot still filling (the one that holds now), `missing` for a slot where nothing was recorded (send its value as null, never 0). Any other value, or none, is a whole slot. A bar still filling is drawn as a faint fill inside a dashed outline in its series colour, and its hover value ends 'so far'; a slot with no data draws no bar but a hatched band labelled 'No data', whose hover reads 'No data · 25 Nov, 09:00 to 10:00'. A legend entry 'so far' or 'no data' is added under the chart only when such a slot is drawn. A band is drawn only where every series of the slot has no data. Independently of this field, a measured 0 (in a slot that is not missing) is a 2px hairline on the baseline in the neutral grey, so a zero reads as measured and is never painted in a series colour.
       */
      slotField?: string
      /**
       * field mapped to color / series (G2 `colorField`)
       */
      colorField?: string
      /**
       * stack series sharing an x value (G2 `stack`)
       */
      stack?: boolean
      /**
       * group series side-by-side at each x value (G2 `group`)
       */
      group?: boolean
      /**
       * show the legend; false hides it (G2 `legend`)
       */
      legend?: boolean
      /**
       * chart title (G2 `title`)
       */
      title?: string
      /**
       * fixed height in px (G2 `height`); omit to autofit
       */
      height?: number
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
