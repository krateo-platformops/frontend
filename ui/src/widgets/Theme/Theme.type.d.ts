export interface Theme {
  /**
   * Widget API version.
   */
  version: string
  /**
   * Theme applies tenant brand overrides app-wide (Brand v2, issue #49 §7). It renders no visible UI — a side-effect widget that sets CSS custom properties on :root. Mount one globally (e.g. in the app-shell).
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * Tenant Theme overrides (Brand v2, issue #49 §7). Every field is optional — a Theme overrides any SUBSET. Tier-2 tokens (status/agent/focus ring/chart palette) are intentionally NOT here: they are locked and cannot be overridden by a tenant.
     */
    widgetData: {
      /**
       * when set, PIN the color mode (overrides the user's light/dark toggle preference for this tenant)
       */
      mode?: 'dark' | 'light'
      /**
       * tenant brand logo (used on the login panel; sider brand is chart-driven)
       */
      logo?: {
        /**
         * logo image URL
         */
        url?: string
        /**
         * logo alt text
         */
        alt?: string
      }
      /**
       * overridable Tier-1 design tokens. Applied as CSS custom properties (--krateo-* / legacy --*-color) at runtime, so CSS-module and index.css styling re-tint. Only these named tokens are overridable.
       */
      token?: {
        /**
         * brand/interaction colour → --primary-color + --krateo-color-action-primary
         */
        colorPrimary?: string
        /**
         * page background → --background-color + --krateo-color-background-base
         */
        colorBgLayout?: string
        /**
         * card/panel surface → --panelbg-color + --krateo-color-background-surface
         */
        colorBgContainer?: string
        /**
         * hairline border → --border-color + --krateo-color-border-subtle
         */
        colorBorder?: string
        /**
         * default text → --text-color + --krateo-color-text-default
         */
        colorText?: string
        /**
         * UI font stack → --font-family + --krateo-font-ui
         */
        fontFamily?: string
        /**
         * base font size in px
         */
        fontSize?: number
      }
      /**
       * non-token brand chrome overrides (sidebar + nav)
       */
      custom?: {
        /**
         * sidebar rail gradient stops (→ --krateo-nav-gradient-* / --menubgstart/end-color)
         */
        sidebar?: {
          /**
           * Start colour of the sidebar background gradient.
           */
          bgGradientStart?: string
          /**
           * End colour of the sidebar background gradient.
           */
          bgGradientEnd?: string
        }
        /**
         * sidebar nav-item colours (→ --menuitem-color / --menuitembg-color / --krateo-nav-item*)
         */
        menu?: {
          /**
           * Text colour of an idle menu item.
           */
          itemColor?: string
          /**
           * Text colour of a menu item under the pointer.
           */
          itemHoverColor?: string
          /**
           * Background of the selected menu item.
           */
          itemSelectedBg?: string
          /**
           * Text colour of the selected menu item.
           */
          itemSelectedColor?: string
        }
      }
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
    [k: string]: unknown
  }
}
