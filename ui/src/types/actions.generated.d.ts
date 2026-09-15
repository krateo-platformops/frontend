/**
 * Canonical action-map shared by every action-bearing widget (Button, Form, List rows). Single source of truth: widget schemas copy this verbatim into widgetData.actions (validate-schemas enforces no drift) and the WidgetActions type is generated from it.
 */
export interface WidgetActions {
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
