export interface Table {
  version: string
  /**
   * Table displays structured data with customizable columns and pagination
   */
  kind: string
  spec: {
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
         * the color of the value (or the icon) to be represented
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
    resourcesRefs?: {
      items: {
        allowed?: boolean
        apiVersion?: string
        id: string
        name?: string
        namespace?: string
        payload?: {
          [k: string]: unknown
        }
        resource?: string
        verb?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
        slice?: {
          offset?: number
          page: number
          perPage: number
          continue?: boolean
          [k: string]: unknown
        }
        [k: string]: unknown
      }[]
      [k: string]: unknown
    }
    apiRef?: {
      name: string
      namespace: string
    }
    widgetDataTemplate?: {
      forPath?: string
      expression?: string
    }[]
    resourcesRefsTemplate?: {
      iterator?: string
      template?: {
        apiVersion?: string
        id?: string
        name?: string
        namespace?: string
        payload?: {
          [k: string]: unknown
        }
        resource?: string
        verb?: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'
      }
    }[]
  }
}
