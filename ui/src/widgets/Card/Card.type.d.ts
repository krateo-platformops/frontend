export interface Card {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Card is a container to display information
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties Card renders. Where Card wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * renders this panel with a DOM id so an in-page `[text](#anchorId)` link (e.g. a summary/table-of-contents Markdown widget) scrolls to it
       */
      anchorId?: string
      /**
       * the Krateo event actions of the widget (renamed from `actions`, which collides with antd Card.actions)
       */
      widgetActions?: {
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
       * the id of the action to be executed when the panel is clicked
       */
      clickActionId?: string
      /**
       * footer section of the panel containing additional items
       */
      footer?: {
        /**
         * the identifier of the k8s custom resource that should be represented, usually a widget
         */
        resourceRefId: string
      }[]
      /**
       * optional text to be displayed under the title, on the left side of the Card
       */
      headerLeft?: string
      /**
       * antd Card extra — content shown top-right of the card header (renamed from `headerRight`)
       */
      extra?: string
      /**
       * how `extra` renders top-right: `text` (default, plain), `badge` (glow dot + uppercase mono, for CONVERGED/DRIFT/DEGRADED), or `tag` (soft antd Tag pill — for Up to date / status labels)
       */
      extraVariant?: 'text' | 'badge' | 'tag'
      /**
       * colour token: antd Badge status for `extraVariant: badge`; antd Tag color for `extraVariant: tag`
       */
      extraStatus?:
        'success' | 'processing' | 'warning' | 'error' | 'default' | 'green' | 'gold' | 'red' | 'blue' | 'violet'
      /**
       * resourceRefId of a widget (e.g. a Button) rendered top-right of the card header — a real, independently-actioned slot with its own icon/size/navigation, distinct from the plain-text `extra`. Mirrors the `cover`/`footer` widget slots; renders a nested WidgetRenderer, so it does NOT make the whole card the click target the way `extra` + `clickActionId` does.
       */
      extraRefId?: string
      /**
       * show a pulsing "Live" badge next to the card title (for cards backed by a live/SSE feed)
       */
      live?: boolean
      /**
       * optional legend key shown top-right of the card header (e.g. the reconciliation-rail actual/drift/target swatches): each item is a small colour swatch + label
       */
      legend?: {
        /**
         * swatch colour (palette name, e.g. cyan / magenta / amber)
         */
        color: string
        /**
         * swatch label (e.g. actual / drift / target)
         */
        label: string
      }[]
      /**
       * antd Card variant
       */
      variant?: 'outlined' | 'borderless'
      /**
       * antd Card size
       */
      size?: 'default' | 'small'
      /**
       * resourceRefId of a widget rendered as the antd Card cover
       */
      cover?: string
      /**
       * icon displayed in the panel header
       */
      icon?: {
        /**
         * name of the icon to display (font awesome icon name eg: `fa-inbox`)
         */
        name: string
        /**
         * color of the icon
         */
        color?: string
      }
      /**
       * list of resource references to display as main content in the panel
       */
      items: {
        /**
         * the identifier of the k8s custom resource that should be represented, usually a widget
         */
        resourceRefId: string
      }[]
      /**
       * list of string tags to be displayed in the footer
       */
      tags?: string[]
      /**
       * text to be displayed as the panel title
       */
      title?: string
      /**
       * how the panel title is rendered. 'heading' (default) = readable card heading (marketplace tiles, detail headers). 'eyebrow' = small mono uppercase letter-spaced muted caption (flight-deck section/panel labels).
       */
      titleVariant?: 'heading' | 'eyebrow'
      /**
       * optional tooltip text shown on the top right side of the card to provide additional context
       */
      tooltip?: string
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
    resourcesRefs: {
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
