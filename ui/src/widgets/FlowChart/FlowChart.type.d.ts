export interface FlowChart {
  /**
   * Widget API version.
   */
  version: string
  /**
   * FlowChart represents a Kubernetes composition as a directed graph. Each node represents a resource, and edges indicate parent-child relationships
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties FlowChart renders. Where FlowChart wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * list of kubernetes resources and their relationships to render as nodes in the flow chart
       */
      data: {
        /**
         * optional date value to be shown in the node, formatted as ISO 8601 string
         */
        date: string
        /**
         * custom icon displayed for the resource node
         */
        icon?: {
          /**
           * FontAwesome icon class name (e.g. 'fa-check')
           */
          name?: string
          /**
           * CSS color value for the icon background
           */
          color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
          /**
           * optional tooltip message displayed on hover
           */
          message?: string
        }
        /**
         * custom status icon displayed alongside resource info
         */
        statusIcon?: {
          /**
           * FontAwesome icon class name representing status
           */
          name?: string
          /**
           * CSS color value for the status icon background
           */
          color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
          /**
           * optional tooltip message describing the status
           */
          message?: string
        }
        /**
         * kubernetes resource type (e.g. Deployment, Service)
         */
        kind: string
        /**
         * name of the resource
         */
        name: string
        /**
         * namespace in which the resource is defined
         */
        namespace: string
        /**
         * list of parent resources used to define graph relationships
         */
        parentRefs?: {
          /**
           * optional date value to be shown in the node, formatted as ISO 8601 string
           */
          date?: string
          /**
           * custom icon for the parent resource
           */
          icon?: {
            /**
             * FontAwesome icon class name
             */
            name?: string
            /**
             * CSS color value for the icon background
             */
            color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
            /**
             * optional tooltip message
             */
            message?: string
          }
          /**
           * custom status icon for the parent resource
           */
          statusIcon?: {
            /**
             * FontAwesome icon class name
             */
            name?: string
            /**
             * CSS color value for the status icon background
             */
            color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
            /**
             * optional tooltip message
             */
            message?: string
          }
          /**
           * resource type of the parent
           */
          kind?: string
          /**
           * name of the parent resource
           */
          name?: string
          /**
           * namespace of the parent resource
           */
          namespace?: string
          /**
           * nested parent references for recursive relationships
           */
          parentRefs?: {
            [k: string]: unknown
          }[]
          /**
           * internal version string of the parent resource
           */
          resourceVersion?: string
          /**
           * unique identifier of the parent resource
           */
          uid?: string
          /**
           * api version of the parent resource
           */
          version?: string
          [k: string]: unknown
        }[]
        /**
         * internal version string of the resource
         */
        resourceVersion: string
        /**
         * unique identifier of the resource
         */
        uid: string
        /**
         * api version of the resource
         */
        version: string
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
