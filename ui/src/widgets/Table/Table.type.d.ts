export interface Table {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Table displays structured data with customizable columns and pagination
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties Table renders. Where Table wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * the list of resources that are allowed to be children of this widget or referenced by it
       */
      allowedResources: (
        | 'barcharts'
        | 'buttons'
        | 'buttongroups'
        | 'filters'
        | 'flowcharts'
        | 'linecharts'
        | 'markdowns'
        | 'paragraphs'
        | 'piecharts'
        | 'rangepickers'
        | 'yamlviewers'
      )[]
      /**
       * configuration of the table's columns
       */
      columns: {
        /**
         * the color of the value (or the icon) to be represented. These are KRATEO PALETTE names resolved through the shared palette — not antd presets. The same name on a Button takes antd's vocabulary instead and renders a different shade.
         */
        color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
        /**
         * column header label
         */
        title: string
        /**
         * key used to extract the value from row data
         */
        valueKey: string
        /**
         * antd Table column width — a pixel number, or any CSS length string. Mirrors antd ColumnType.width. Optional: omitted, antd sizes the column as it does today.
         */
        width?: number | string
        /**
         * antd Table column minWidth in px. Mirrors antd ColumnType.minWidth. Usually the better lever under fitContent: a fixed width re-creates the overflow it was meant to fix, while a floor keeps a column readable and lets the others flex.
         */
        minWidth?: number
      }[]
      /**
       * antd Table dataSource — the table rows (renamed from `data`; `data` still accepted for back-compat)
       */
      dataSource?: {
        /**
         * the key of the column this cell belongs to
         */
        valueKey: string
        /**
         * type of cell value. `tag` renders the stringValue as a colored antd Tag (use the cell `color`). `bar` renders a reconciliation-rail Progress gauge (stringValue = percent 0-100, `color` = bar/state color, amber target-tick at 100%). `conditions` renders `arrayValue` (an array of {type,status}) as small status pills, each coloured cyan (True) / crimson (False).
         */
        kind: 'jsonSchemaType' | 'icon' | 'widget' | 'tag' | 'bar' | 'conditions'
        /**
         * per-cell color — for a `tag` cell, an antd Tag color (e.g. green / red / gold / blue); for a jsonSchemaType cell it overrides the column color. Lets each row carry its own color (e.g. status).
         */
        color?: string
        /**
         * optional display format for a string value — `relative` (e.g. "14d ago"), `date`, or `datetime`. The raw value stays in the data; only the rendering changes.
         */
        format?: 'relative' | 'date' | 'datetime'
        /**
         * used if kind = widget
         */
        resourceRefId?: string
        /**
         * used if kind = jsonSchemaType
         */
        type?: 'string' | 'number' | 'integer' | 'decimal' | 'boolean' | 'array' | 'null'
        /**
         * value if type = string
         */
        stringValue?: string
        /**
         * value if type = number or integer
         */
        numberValue?: number
        /**
         * value if type = number or decimal
         */
        decimalValue?: string
        /**
         * value if type = boolean
         */
        booleanValue?: boolean
        /**
         * value if type = array
         */
        arrayValue?: string[]
      }[][]
      /**
       * antd Table pagination config (subproperties mirror antd).
       */
      pagination?: {
        /**
         * number of rows per page
         */
        pageSize?: number
        /**
         * default page size
         */
        defaultPageSize?: number
        /**
         * server-side pagination: the TOTAL row count across all pages (the widget's `dataSource` holds only the current page/window). Set by the widgetDataTemplate from the full list length so the pager renders the correct number of pages. When present, the Table uses controlled server-side pagination (each page fetched on demand) instead of client-side slicing of dataSource.
         */
        total?: number
        /**
         * server-side pagination: the 1-based current page (controlled). Usually driven by the request `page` param, not the CR.
         */
        current?: number
        /**
         * hide the pager when there is a single page
         */
        hideOnSinglePage?: boolean
        /**
         * use the simple pager
         */
        simple?: boolean
        /**
         * pager position(s)
         */
        position?: ('topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight')[]
      }
      /**
       * antd Table bordered
       */
      bordered?: boolean
      /**
       * Fit columns to the container instead of horizontal-scrolling: a wide cell ellipsis-truncates (full text on hover) rather than pushing a scrollbar. Ignored for virtualized (very large) tables.
       */
      fitContent?: boolean
      /**
       * antd Table size. Defaults to 'middle' when omitted (matching Button), so an unset value has a documented, Brand-consistent density rather than antd's raw default
       */
      size?: 'large' | 'middle' | 'small'
      /**
       * it's the filters prefix to get right values
       */
      prefix?: string
      /**
       * optional route path to navigate to on row click; `{valueKey}` placeholders are filled from that row's cells (e.g. /compositions/{ns}/{name})
       */
      rowNavigateTo?: string
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
