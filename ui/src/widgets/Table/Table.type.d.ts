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
      allowedResources: string[]
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
         * per-cell color — a KRATEO PALETTE name (gray, red, orange, green, blue, primary…), resolved for the light or dark mode; never a hex, which is one value in both modes. On a jsonSchemaType cell it overrides the column color, and a value that is not a palette name is applied as CSS as written. Lets each row carry its own color (e.g. status).
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
        /**
         * optional antd Tooltip text for this cell, shown on hover and on keyboard focus, for every cell kind (e.g. a span's OTel StatusMessage on its error tag). When set, it replaces the cell's own full-text-on-hover title, so a cell never shows two tooltips. Omitted or empty, the cell renders exactly as without it.
         */
        tooltip?: string
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
       * Whether the reader can resize the columns by dragging the right edge of a header (or with the arrow keys on its handle). On when omitted; set false to keep the columns at the widths the table lays out. Widths a reader set are remembered per viewer in the browser, and ignored while this is false.
       */
      resizableColumns?: boolean
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
       * per-row action controls, rendered in a trailing column of each row as a kebab (⋯) menu or as buttons (see rowActionsDisplay) — the same field List takes as itemTemplate.rowActions. Each entry references an action id from widgetData.actions and is fired with the row's values as the action payload (customPayload): an object of each cell's valueKey to its value, so a navigate path of /x/${name} goes to that row's `name` cell. A click or key on a control never fires the row's rowNavigateTo, which keeps working everywhere else on the row.
       */
      rowActions?: {
        /**
         * id of an action defined in widgetData.actions to fire when this menu item is clicked
         */
        actionId: string
        /**
         * menu item label
         */
        label: string
        /**
         * optional Font Awesome icon name for the menu item
         */
        icon?: string
        /**
         * render the menu item in a destructive (red) style
         */
        danger?: boolean
      }[]
      /**
       * how rowActions are presented: menu (a kebab (⋯) in the row's last cell, default) | buttons (antd Buttons in the row's last cell, in declared order: the first primary, the rest default, a danger entry as danger). The whole-row click (rowNavigateTo) is unchanged either way. Same field and values as List's itemTemplate.rowActionsDisplay.
       */
      rowActionsDisplay?: 'menu' | 'buttons'
      /**
       * the actions of the widget (canonical map; see src/schemas/actions.schema.json). Referenced per-row by rowActions.
       */
      actions?: {
        /**
         * rest api call actions triggered by the widget
         */
        rest?: {
          /**
           * unique identifier for the action
           */
          id: string
          /**
           * the identifier of the k8s custom resource that should be represented
           */
          resourceRefId: string
          /**
           * whether user confirmation is required before triggering the action
           */
          requireConfirmation?: boolean
          /**
           * a message that will be displayed inside a toast in case of error
           */
          errorMessage?: string
          /**
           * name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action
           */
          fanOutPath?: string
          /**
           * ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's)
           */
          ops?: {
            /**
             * the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base
             */
            resourceRefId: string
            /**
             * static payload sent with this op's request
             */
            payload?: {
              [k: string]: unknown
            }
            /**
             * list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op)
             */
            payloadToOverride?: {
              /**
               * name of the field to override
               */
              name: string
              /**
               * value to use for overriding the field
               */
              value: string
            }[]
          }[]
          /**
           * a message that will be displayed inside a toast in case of success
           */
          successMessage?: string
          /**
           * url to navigate to after successful execution
           */
          onSuccessNavigateTo?: string
          /**
           * conditional navigation triggered by a specific event
           */
          onEventNavigateTo?: {
            /**
             * identifier of the awaited event reason
             */
            eventReason: string
            /**
             * url to navigate to when the event is received
             */
            url: string
            /**
             * the timeout in seconds to wait for the event
             */
            timeout?: number
            /**
             * Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens.
             */
            reloadRoutes?: boolean
            /**
             * message to display while waiting for the event
             */
            loadingMessage?: string
          }
          /**
           * type of action to execute
           */
          type: 'rest'
          /**
           * array of headers as strings, format 'key: value'
           *
           * Items: key and value as a single, example: 'x-custom-header: value'
           */
          headers: string[]
          /**
           * static payload sent with the request
           */
          payload?: {
            [k: string]: unknown
          }
          /**
           * list of payload fields to override dynamically
           */
          payloadToOverride?: {
            /**
             * name of the field to override
             */
            name: string
            /**
             * value to use for overriding the field
             */
            value: string
          }[]
          /**
           * Whether this action shows an in-flight indicator while it runs.
           */
          loading?: {
            /**
             * Show the in-flight indicator. Set false to run the action without one.
             */
            display: boolean
          }
        }[]
        /**
         * client-side navigation actions
         */
        navigate?: {
          /**
           * unique identifier for the action
           */
          id: string
          /**
           * Whether this action shows an in-flight indicator while it runs.
           */
          loading?: {
            /**
             * Show the in-flight indicator. Set false to run the action without one.
             */
            display: boolean
          }
          /**
           * the identifier of the route to navigate to
           */
          path?: string
          /**
           * the identifier of the k8s custom resource that should be represented
           */
          resourceRefId?: string
          /**
           * whether user confirmation is required before navigating
           */
          requireConfirmation?: boolean
          /**
           * type of navigation action
           */
          type: 'navigate'
        }[]
        /**
         * actions to open side drawer components
         */
        openDrawer?: {
          /**
           * unique identifier for the drawer action
           */
          id: string
          /**
           * type of drawer action
           */
          type: 'openDrawer'
          /**
           * the identifier of the k8s custom resource that should be represented
           */
          resourceRefId: string
          /**
           * whether user confirmation is required before opening
           */
          requireConfirmation?: boolean
          /**
           * drawer size to be displayed
           */
          size?: 'default' | 'large'
          /**
           * title shown in the drawer header
           */
          title?: string
          /**
           * Whether this action shows an in-flight indicator while it runs.
           */
          loading?: {
            /**
             * Show the in-flight indicator. Set false to run the action without one.
             */
            display: boolean
          }
        }[]
        /**
         * actions to open modal dialog components
         */
        openModal?: {
          /**
           * unique identifier for the modal action
           */
          id: string
          /**
           * type of modal action
           */
          type: 'openModal'
          /**
           * the identifier of the k8s custom resource that should be represented
           */
          resourceRefId: string
          /**
           * whether user confirmation is required before opening
           */
          requireConfirmation?: boolean
          /**
           * title shown in the modal header
           */
          title?: string
          /**
           * Whether this action shows an in-flight indicator while it runs.
           */
          loading?: {
            /**
             * Show the in-flight indicator. Set false to run the action without one.
             */
            display: boolean
          }
          /**
           * the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property
           */
          customWidth?: string
          /**
           * sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property
           */
          size?: 'default' | 'large' | 'fullscreen' | 'custom'
        }[]
      }
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
