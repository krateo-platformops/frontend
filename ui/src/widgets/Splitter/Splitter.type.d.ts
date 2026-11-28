export interface Splitter {
  /**
   * widget version
   */
  version: string
  /**
   * Splitter divides an area into panels side by side (or stacked) that the reader resizes by dragging the bar between them; each panel holds a child widget
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * the data that will be passed to the widget on the frontend
     */
    widgetData: {
      /**
       * the resource plurals this container may hold as children. Typed loosely on purpose; containment is checked by the chart lint (design rule X5) against the real widget registry.
       */
      allowedResources: string[]
      /**
       * antd Splitter `orientation`: `horizontal` sets the panels side by side, `vertical` stacks them. Default horizontal.
       */
      orientation?: 'horizontal' | 'vertical'
      /**
       * the splitter's height in pixels. A vertical splitter needs one, since its panels share it; absent, a horizontal splitter is as tall as its tallest panel.
       */
      height?: number
      /**
       * antd Splitter `lazy`: the panels take their new sizes when the bar is released, not while it is dragged. For panels whose content is costly to lay out (a large table, a chart).
       */
      lazy?: boolean
      /**
       * the panels, in order (left to right, or top to bottom).
       *
       * @minItems 2
       */
      items: [
        {
          /**
           * the identifier of the k8s custom resource drawn inside the panel
           */
          resourceRefId: string
          /**
           * antd Splitter.Panel `defaultSize`: the panel's starting size, in percent ("25%") or pixels ("240px"). Absent, the panels without one share the space left equally.
           */
          defaultSize?: string
          /**
           * antd Splitter.Panel `min`: the smallest the reader can drag the panel to, "NN%" or "NNpx".
           */
          min?: string
          /**
           * antd Splitter.Panel `max`: the largest the reader can drag the panel to, "NN%" or "NNpx".
           */
          max?: string
          /**
           * antd Splitter.Panel `resizable`: false fixes the panel at its size. Default true.
           */
          resizable?: boolean
          /**
           * which edge of the panel shows a button that folds it shut: `start` (its left or top edge), `end` (its right or bottom edge), or `both`. Absent, the panel cannot be folded.
           */
          collapsible?: 'start' | 'end' | 'both'
        },
        {
          /**
           * the identifier of the k8s custom resource drawn inside the panel
           */
          resourceRefId: string
          /**
           * antd Splitter.Panel `defaultSize`: the panel's starting size, in percent ("25%") or pixels ("240px"). Absent, the panels without one share the space left equally.
           */
          defaultSize?: string
          /**
           * antd Splitter.Panel `min`: the smallest the reader can drag the panel to, "NN%" or "NNpx".
           */
          min?: string
          /**
           * antd Splitter.Panel `max`: the largest the reader can drag the panel to, "NN%" or "NNpx".
           */
          max?: string
          /**
           * antd Splitter.Panel `resizable`: false fixes the panel at its size. Default true.
           */
          resizable?: boolean
          /**
           * which edge of the panel shows a button that folds it shut: `start` (its left or top edge), `end` (its right or bottom edge), or `both`. Absent, the panel cannot be folded.
           */
          collapsible?: 'start' | 'end' | 'both'
        },
        ...{
          /**
           * the identifier of the k8s custom resource drawn inside the panel
           */
          resourceRefId: string
          /**
           * antd Splitter.Panel `defaultSize`: the panel's starting size, in percent ("25%") or pixels ("240px"). Absent, the panels without one share the space left equally.
           */
          defaultSize?: string
          /**
           * antd Splitter.Panel `min`: the smallest the reader can drag the panel to, "NN%" or "NNpx".
           */
          min?: string
          /**
           * antd Splitter.Panel `max`: the largest the reader can drag the panel to, "NN%" or "NNpx".
           */
          max?: string
          /**
           * antd Splitter.Panel `resizable`: false fixes the panel at its size. Default true.
           */
          resizable?: boolean
          /**
           * which edge of the panel shows a button that folds it shut: `start` (its left or top edge), `end` (its right or bottom edge), or `both`. Absent, the panel cannot be folded.
           */
          collapsible?: 'start' | 'end' | 'both'
        }[]
      ]
    }
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
