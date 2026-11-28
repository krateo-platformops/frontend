export interface Segmented {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Segmented renders an antd Segmented: a row of mutually exclusive choices that switches the VIEW of a page (a range: 1h / 6h / 24h; a layout: Table / Graph; a scope: Mine / All). It is standalone and URL-bound: the choice lives in a URL search param (`queryParam`), so a link names it, the back button undoes it, and data sources read it as request `extras`, as the URL-bound Select and RangePicker do. For a choice that is a form field, use Radio with `optionType: button`.
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    widgetData: {
      /**
       * the URL search param the choice is read from and written to (eg: `range` → `?range=6h`). Other params on the URL are kept
       */
      queryParam: string
      /**
       * the choices, in order (antd Segmented `options`)
       *
       * @minItems 2
       */
      options: [
        {
          /**
           * what is written to `?<queryParam>=`
           */
          value: string
          /**
           * the text drawn in the segment. Unset, the value; set to an empty string with an `icon`, an icon-only segment (then give it a `tooltip`, which is also its accessible name)
           */
          label?: string
          /**
           * a font awesome icon name drawn before the label (eg: `fa-table`)
           */
          icon?: string
          /**
           * a tooltip on the segment (antd option `tooltip`)
           */
          tooltip?: string
          /**
           * show the segment but do not let it be chosen (antd option `disabled`)
           */
          disabled?: boolean
        },
        {
          /**
           * what is written to `?<queryParam>=`
           */
          value: string
          /**
           * the text drawn in the segment. Unset, the value; set to an empty string with an `icon`, an icon-only segment (then give it a `tooltip`, which is also its accessible name)
           */
          label?: string
          /**
           * a font awesome icon name drawn before the label (eg: `fa-table`)
           */
          icon?: string
          /**
           * a tooltip on the segment (antd option `tooltip`)
           */
          tooltip?: string
          /**
           * show the segment but do not let it be chosen (antd option `disabled`)
           */
          disabled?: boolean
        },
        ...{
          /**
           * what is written to `?<queryParam>=`
           */
          value: string
          /**
           * the text drawn in the segment. Unset, the value; set to an empty string with an `icon`, an icon-only segment (then give it a `tooltip`, which is also its accessible name)
           */
          label?: string
          /**
           * a font awesome icon name drawn before the label (eg: `fa-table`)
           */
          icon?: string
          /**
           * a tooltip on the segment (antd option `tooltip`)
           */
          tooltip?: string
          /**
           * show the segment but do not let it be chosen (antd option `disabled`)
           */
          disabled?: boolean
        }[]
      ]
      /**
       * the choice shown while the URL has no `?<queryParam>=`. Choosing it removes the param, so the page's plain address stays its default. Unset, the first option
       */
      defaultValue?: string
      /**
       * what the group of choices is, for a screen reader (eg: `Time range`): the segments name the options, not the question
       */
      ariaLabel?: string
      /**
       * antd Segmented `size`
       */
      size?: 'small' | 'middle' | 'large'
      /**
       * antd Segmented `shape`: `round` draws pill-shaped segments
       */
      shape?: 'default' | 'round'
      /**
       * fill the container's width, the segments sharing it equally (antd Segmented `block`)
       */
      block?: boolean
      /**
       * stack the segments vertically (antd Segmented `vertical`)
       */
      vertical?: boolean
      /**
       * disable every segment (antd Segmented `disabled`)
       */
      disabled?: boolean
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
