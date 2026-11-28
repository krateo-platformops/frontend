export interface PageHeader {
  /**
   * widget version
   */
  version?: string
  /**
   * name of the k8s Custom Resource
   */
  kind?: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec?: {
    /**
     * the data that will be passed to the widget on the frontend
     */
    widgetData: {
      /**
       * the page title (H1). The one required field — a page header without a title is not a page header
       */
      title: string
      /**
       * an optional count rendered in brackets beside the title, on the title's own type step (e.g. '(397)'). Use for 'how many of these are there', never for a status
       */
      counter?: number
      /**
       * the noun the counter counts, rendered inside the same brackets (e.g. '23 blueprints'). Use it when WHAT is being counted changes — a bare '(23)' beside a filtered catalog does not say 23 of what
       */
      counterLabel?: string
      /**
       * one line of supporting context below the title. Must NOT restate the title — say it once per page. A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"), e.g. "Composition · ns · created {ago:2026-11-04T10:10:27Z}". Never an age computed in jq: snowplow caches the rendered text with `now` frozen.
       */
      subtitle?: string
      /**
       * status pills on the title line, vertically centred with it
       */
      tags?: {
        /**
         * the pill text. Required: a colour with no label carries meaning by colour alone, which a screen reader and a colourblind reader both miss
         */
        label: string
        /**
         * a palette colour NAME (resolved through the shared palette, never an antd preset or a hex)
         */
        color?: 'blue' | 'darkBlue' | 'orange' | 'gray' | 'red' | 'green' | 'violet'
      }[]
      /**
       * a quiet line of muted text after the pills on the title line, e.g. "about the previous version · updating": what the pills say is true but about to change. Absent or empty text, nothing is drawn
       */
      note?: {
        /**
         * the note, in plain words; an empty string draws nothing
         */
        text: string
        /**
         * the longer explanation shown on hover and focus
         */
        tooltip?: string
      }
      /**
       * something on this page is in progress (an analysis, a check): one line under the title saying since when, with the time waited ticking in the browser while `live` is true ("Re-analysis since 21 Nov, 12:54 · 12 minutes"). No ETA. The page itself updates when the state changes; this line only keeps the wait visible. null means no progress line: a RESTAction that has nothing in progress sends null, because a widgetDataTemplate cannot leave the path unset (snowplow writes "" for no output) and the CRD must admit what it then writes.
       */
      progress?: {
        /**
         * what is happening, as the lead-in to the time, e.g. "Re-analysis since" or "Resolved at"
         */
        label: string
        /**
         * RFC 3339 timestamp it started (or settled); shown as a moment in the viewer's time zone ("21 Nov, 12:54"), the full date on hover
         */
        since: string
        /**
         * still running: show the time waited (an age, "12 minutes"), ticking, and a live mark. False or absent: a settled time only, nothing ticks
         */
        live?: boolean
        /**
         * one muted line under it while live, e.g. "Usually 2–3 min; longer when the model is rate-limited."
         */
        hint?: string
      } | null
      /**
       * the list of resources that are allowed to be children of this widget or referenced by it
       */
      allowedResources?: string[]
      /**
       * the page's actions, rendered on ONE row on the right edge, vertically centred on the title and subtitle together (level with the title when there is no subtitle); never stacked (design rule P26). At most one should be `type: primary`
       */
      items?: {
        /**
         * Handle of the child to render here, matching an `id` in spec.resourcesRefs.
         */
        resourceRefId: string
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
    [k: string]: unknown
  }
}
