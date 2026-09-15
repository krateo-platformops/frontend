export interface Layout {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Layout wraps the Ant Design Layout component: optional Header, Sider, Content and Footer regions, each rendering a child widget. The Sider exposes antd's collapse/responsive props.
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties Layout renders. Where Layout wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * antd Layout `hasSider` — declares a Sider child so the flex direction is correct on first paint
       */
      hasSider?: boolean
      /**
       * resourceRefId of the widget rendered in antd Layout.Header
       */
      header?: string
      /**
       * resourceRefId of the widget rendered in antd Layout.Content
       */
      content?: string
      /**
       * resourceRefId of the widget rendered in antd Layout.Footer
       */
      footer?: string
      /**
       * resourceRefIds of side-effect widgets (e.g. Theme) rendered invisibly: they set global state (CSS custom properties, etc.) and produce no UI. Use for app-wide concerns mounted once on the shell.
       */
      effects?: string[]
      /**
       * antd Layout.Sider region
       */
      sider?: {
        /**
         * resourceRefId of the widget rendered inside the Sider
         */
        resourceRefId?: string
        /**
         * antd Sider `width` in px
         */
        width?: number
        /**
         * antd Sider `collapsible` (renders a collapse trigger)
         */
        collapsible?: boolean
        /**
         * antd Sider `collapsedWidth` in px
         */
        collapsedWidth?: number
        /**
         * antd Sider responsive `breakpoint`; auto-collapses below it
         */
        breakpoint?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
        /**
         * antd Sider `theme`
         */
        theme?: 'light' | 'dark'
        /**
         * antd Sider `defaultCollapsed`
         */
        defaultCollapsed?: boolean
        /**
         * antd Sider `reverseArrow`
         */
        reverseArrow?: boolean
      }
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
         * Plural resource name, for example `paragraphs`.
         */
        resource?: string
        /**
         * HTTP verb used to resolve the reference. GET for a read; a mutating verb makes this a write the widget can dispatch.
         */
        verb?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
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
