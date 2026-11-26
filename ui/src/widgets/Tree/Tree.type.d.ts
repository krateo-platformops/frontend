export interface Tree {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Tree renders a hierarchy as an antd Tree: resources and what they own, a catalog by category, a folder layout. The nodes arrive as a FLAT list where each node names its parent (`parentKey`), because that is the shape a RESTAction's jq produces naturally and because a CRD schema cannot recurse. A node can open a page (`navigateTo`).
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    widgetData: {
      /**
       * the nodes, as a flat list. Siblings keep the order they have here. A node whose `parentKey` names no node in the list is shown at the root, so a filtered answer never loses a branch.
       */
      items: {
        /**
         * unique among the nodes: what `parentKey`, `defaultExpandedKeys` and `selectedKey` name (antd TreeNode `key`). When two nodes share a key, the first wins
         */
        key: string
        /**
         * the `key` of the node this one sits under. Unset, the node is a root
         */
        parentKey?: string
        /**
         * the node's label (antd TreeNode `title`)
         */
        title: string
        /**
         * a short muted note after the title, in the data face (eg: a kind, a version, a count)
         */
        description?: string
        /**
         * a font awesome icon name shown before the title (eg: `fa-folder`) (antd TreeNode `icon`)
         */
        icon?: string
        /**
         * the icon colour: a palette colour NAME (resolved through the shared palette for the light or dark mode, never an antd preset or a hex). Unset, the icon takes the muted text colour
         */
        color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
        /**
         * the page selecting this node opens: an app path (eg: `/compositions/demo/my-app`) or an absolute URL. Unset, the node is not selectable
         */
        navigateTo?: string
        /**
         * show the node greyed out and not selectable (antd TreeNode `disabled`)
         */
        disabled?: boolean
      }[]
      /**
       * open every node on first render (antd Tree `defaultExpandAll`)
       */
      defaultExpandAll?: boolean
      /**
       * the nodes open on first render; their ancestors open with them (antd Tree `defaultExpandedKeys` with `defaultExpandParent`)
       */
      defaultExpandedKeys?: string[]
      /**
       * the node shown as selected, eg: the one whose page is open. Its ancestors open with it, so it is in view on first render
       */
      selectedKey?: string
      /**
       * draw the connector lines between parent and children (antd Tree `showLine`)
       */
      showLine?: boolean
      /**
       * a fixed height in pixels: the tree scrolls inside it and draws only the nodes in view, for large trees (antd Tree `height`, virtual scroll)
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
