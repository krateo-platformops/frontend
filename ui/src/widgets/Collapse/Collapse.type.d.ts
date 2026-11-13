export interface Collapse {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Collapse renders a list of collapsible panels, following the Ant Design Collapse API (items, defaultActiveKey, accordion, bordered, ghost, size). The panels come from data, so a page can show one per group it does not know in advance (one per alert, per repo, per day). Each panel's body is a child widget (resourceRefId) or a dataSource rendered through the same list rows Listy draws (itemTemplate, grid), optionally capped to its first N items with a footer link.
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * The properties Collapse renders. Where Collapse wraps an antd component these are antd's own prop names, so antd's documentation for that component describes them.
     */
    widgetData: {
      /**
       * the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry.
       */
      allowedResources?: string[]
      /**
       * antd Collapse `items`: the panels, in order.
       */
      items: {
        /**
         * antd Collapse item `key`: unique among the panels; what defaultActiveKey names.
         */
        key: string
        /**
         * antd Collapse item `label`: the panel's title.
         */
        label: string
        /**
         * how many items the panel holds, drawn as a count badge after the title and read as part of the header's accessible name. Absent, no badge.
         */
        count?: number
        /**
         * exception-only tint for the count badge (antd Tag status colours): `error` for a panel that holds something broken, `warning` for one that needs attention. Absent, the badge is neutral, as a healthy panel's should be. A panel with a status is also open by default when defaultActiveKey is absent.
         */
        status?: 'error' | 'warning'
        /**
         * antd Collapse item `extra`: muted header meta drawn at the header's end, e.g. "12 alerts, largest first".
         */
        extra?: string
        /**
         * antd Collapse item `collapsible`: what toggles the panel (the whole header by default).
         */
        collapsible?: 'header' | 'icon' | 'disabled'
        /**
         * a STATIC body: the child widget to render in the panel, matching an `id` in spec.resourcesRefs. It is fetched the first time the panel opens. Takes precedence over dataSource.
         */
        resourceRefId?: string
        /**
         * a DATA body: the panel's items, each rendered through widgetData.itemTemplate exactly as a Listy row (or card, chip, statistic) is.
         */
        dataSource?: {
          [k: string]: unknown
        }[]
        /**
         * draw only the first `cap` items of dataSource. With cap set, the footer is drawn only when dataSource holds more than cap items; without it, the footer is drawn whenever it is set (a list capped server-side).
         */
        cap?: number
        /**
         * text under the panel's dataSource body, e.g. "See all 37 →" (antd List footer).
         */
        footer?: string
        /**
         * in-app route the footer opens (e.g. the table view filtered to this group); when set the footer renders as a link.
         */
        footerNavigateTo?: string
      }[]
      /**
       * antd Collapse `defaultActiveKey`: the keys of the panels open on first render. Absent, every panel with a `status` starts open and the rest start folded (exception groups open, settled ones folded).
       */
      defaultActiveKey?: string[]
      /**
       * antd Collapse `accordion`: at most one panel open at a time.
       */
      accordion?: boolean
      /**
       * antd Collapse `bordered`.
       */
      bordered?: boolean
      /**
       * antd Collapse `ghost`: borderless, transparent panels.
       */
      ghost?: boolean
      /**
       * antd Collapse `size`.
       */
      size?: 'small' | 'middle' | 'large'
      /**
       * serializable substitute for antd renderItem: maps a data element's fields to row slots ({dot.path}; {a|b} first-non-empty)
       */
      itemTemplate?: {
        /**
         * {dot.path} to the row's main label.
         */
        primaryText?: string
        /**
         * {dot.path} to the value shown opposite the primary text.
         */
        secondaryText?: string
        /**
         * {dot.path} to the line beneath the primary text.
         */
        subPrimaryText?: string
        /**
         * {dot.path} to the line beneath the secondary text.
         */
        subSecondaryText?: string
        /**
         * longer body line (2-line clamp); only rendered by the card rowVariant (e.g. a catalog tile description)
         */
        description?: string
        /**
         * card-footer call-to-action cue (e.g. "Configure") shown footer-left when a card rowVariant is clickable (navigateTo); rendered as mono amber text + a sliding arrow (a navigation hint, not a button)
         */
        cardCta?: string
        /**
         * {dot.path} to an icon name, or a literal name, shown at the row leading edge.
         */
        icon?: string
        /**
         * leading-indicator style: avatar (solid disc + glyph, default), tile (soft-tint rounded square + glyph), dot (small status dot + halo)
         */
        iconVariant?: 'avatar' | 'tile' | 'dot'
        /**
         * row layout: default (antd List.Item.Meta — avatar + stacked title/description) | tree (tight single-line mono Relations row: connector + status dot + primaryText + muted inline subPrimaryText + right-aligned colored secondaryText) | card (full antd Card tile — icon-tile + name + version badge (subPrimaryText) + category tag (secondaryText) + description + a footer of rowActions as visible buttons — the Marketplace catalog grid) | chip (compact navigable filter pill — primaryText label + optional count, solid/amber when the item's active flag is set — the data-driven Marketplace facet chips; a chip whose data element carries `removable: true` is an applied filter: a trailing remove mark, the accessible name "Remove filter: <primaryText>", and its navigateTo is the URL without that value) | statistic (one tile of a stats strip: an antd Card holding an antd Statistic, primaryText the title, secondaryText the value, subPrimaryText a secondary caption; `color` tints the value and frame ONLY when it resolves, so the healthy majority stays neutral; without `grid` the tiles fill the row and reflow as it narrows)
         */
        rowVariant?: 'default' | 'tree' | 'card' | 'chip' | 'statistic'
        /**
         * render secondaryText as a soft-tint Tag pill (e.g. a category) instead of plain text
         */
        secondaryTextAsTag?: boolean
        /**
         * render subPrimaryText as a small mono bordered pill (e.g. an event involvedObject Kind/name ref) instead of plain sub-text
         */
        subPrimaryTextMono?: boolean
        /**
         * one line each for primaryText and subPrimaryText in the default row, the full text in a tooltip (antd Typography ellipsis)
         */
        ellipsis?: boolean
        /**
         * per-item navigation target ({dot.path} template, e.g. {link}); when it resolves non-empty the row becomes clickable and navigates there (SPA route)
         */
        navigateTo?: string
        /**
         * Resolves the row's accent colour per item, so colour carries meaning from the data rather than being fixed by the author.
         */
        color?: {
          /**
           * {dot.path} to the value the colour is chosen from.
           */
          value?: string
          /**
           * Maps a resolved value to a colour token, for example `Ready` to green.
           */
          map?: {
            [k: string]: string
          }
          /**
           * Colour used when the resolved value is absent from the map.
           */
          default?: string
        }
        /**
         * an at-a-glance status indicator (a Font Awesome glyph) rendered top-right of the `card` rowVariant. Each field is a {dot.path} resolved per item; the raw-value -> glyph/colour mapping is computed server-side (jq in the RESTAction), so the widget stays strongly typed. E.g. a blueprint's CompositionDefinition Ready condition resolved to {readyIcon}/{readyColor}/{readyReason}.
         */
        status?: {
          /**
           * {dot.path} to the resolved Font Awesome icon name (e.g. {readyIcon})
           */
          icon?: string
          /**
           * {dot.path} to the resolved palette colour (e.g. {readyColor})
           */
          color?: string
          /**
           * {dot.path} tooltip text shown on hover (e.g. {readyReason})
           */
          tooltip?: string
        }
        /**
         * per-row horizontal Progress bar (the reconciliation-rail row): an antd Progress line whose percent + stroke colour are resolved per item
         */
        bar?: {
          /**
           * {dot.path} to a 0-100 number (e.g. {healthPercent})
           */
          percent?: string
          /**
           * Resolves the bar's stroke colour per item.
           */
          color?: {
            /**
             * {dot.path} to the value the stroke colour is chosen from.
             */
            value?: string
            /**
             * Maps a resolved value to a stroke colour token.
             */
            map?: {
              [k: string]: string
            }
            /**
             * Stroke colour used when the resolved value is absent from the map.
             */
            default?: string
          }
          /**
           * optional trailing {dot.path} label (e.g. the % text or 7/7)
           */
          label?: string
          /**
           * {dot.path} tooltip text shown when the bar's label is hovered or focused (e.g. {rail.reason}). Resolving to empty leaves the label without a tooltip.
           */
          tooltip?: string
          /**
           * Bar style: `line` for a standalone progress line, `rail` for the denser reconciliation-rail treatment.
           */
          variant?: 'line' | 'rail'
        }
        /**
         * Per-field rendering applied after each {dot.path} resolves.
         */
        formats?: {
          /**
           * How the resolved value is rendered: `text` verbatim, `datetime` as an absolute timestamp, `relative` as a time-ago.
           */
          primaryText?: 'text' | 'datetime' | 'relative'
          /**
           * How the resolved value is rendered: `text` verbatim, `datetime` as an absolute timestamp, `relative` as a time-ago.
           */
          secondaryText?: 'text' | 'datetime' | 'relative'
          /**
           * How the resolved value is rendered: `text` verbatim, `datetime` as an absolute timestamp, `relative` as a time-ago.
           */
          subPrimaryText?: 'text' | 'datetime' | 'relative'
          /**
           * How the resolved value is rendered: `text` verbatim, `datetime` as an absolute timestamp, `relative` as a time-ago.
           */
          subSecondaryText?: 'text' | 'datetime' | 'relative'
        }
        /**
         * per-row action controls rendered on each row as a kebab (⋯) menu or as buttons (see rowActionsDisplay); each entry references an action id from widgetData.actions and is fired with the row's data as the action payload (customPayload). Distinct from navigateTo (whole-row click).
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
         * how the default rowVariant presents rowActions: menu (a kebab (⋯) at the row's end, default) | buttons (antd Buttons at the row's end, in declared order: the first primary, the rest default, a danger entry as danger). The whole-row click (navigateTo) is unchanged either way. The card rowVariant always renders buttons.
         */
        rowActionsDisplay?: 'menu' | 'buttons'
      }
      /**
       * antd List grid layout (ListGridType); presence enables grid mode
       */
      grid?: {
        /**
         * Spacing between grid columns, in pixels. Mirrors antd List `grid.gutter`.
         */
        gutter?: number
        /**
         * Number of columns at the default breakpoint. Mirrors antd List `grid.column`.
         */
        column?: number
        /**
         * Number of columns at the extra-small breakpoint. Mirrors antd List `grid.xs`.
         */
        xs?: number
        /**
         * Number of columns at the small breakpoint. Mirrors antd List `grid.sm`.
         */
        sm?: number
        /**
         * Number of columns at the medium breakpoint. Mirrors antd List `grid.md`.
         */
        md?: number
        /**
         * Number of columns at the large breakpoint. Mirrors antd List `grid.lg`.
         */
        lg?: number
        /**
         * Number of columns at the extra-large breakpoint. Mirrors antd List `grid.xl`.
         */
        xl?: number
        /**
         * Number of columns at the extra-extra-large breakpoint. Mirrors antd List `grid.xxl`.
         */
        xxl?: number
      }
      /**
       * the actions of the widget (canonical map; see src/schemas/actions.schema.json). Referenced per-row by itemTemplate.rowActions in the panels' dataSource bodies.
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
