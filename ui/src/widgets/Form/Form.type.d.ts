export interface Form {
  /**
   * widget version
   */
  version: string
  /**
   * name of the k8s Custom Resource
   */
  kind: string
  /**
   * The widget's contract: its own data, an optional binding to a RESTAction, the resources it references, and any templated overrides.
   */
  spec: {
    /**
     * the data that will be passed to the widget on the frontend
     */
    widgetData: {
      /**
       * the actions of the widget
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
       * the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry.
       */
      allowedResources?: string[]
      /**
       * Configuration for the Autocomplete form fields. The field options could be configured using enum values coming from the schema or via an API call made using a RESTAction which sould be defined below. The RESTActions shuold contain a `status` field, which is an array of object with the `{ label, value }` format.
       */
      autocomplete?: {
        /**
         * parameter to be added to the RESTAction call
         */
        extra?: {
          /**
           * the key of the additional parameter
           */
          key: string
        }
        /**
         * the name of the autocomplete field
         */
        name: string
        /**
         * the identifier of the RESTAction that should be called to retrieve autocomplete data
         */
        resourceRefId?: string
        /**
         * true: only a listed value is accepted (a select); false: the list suggests and typed text is kept. Default false (the previous frontend rendered autocomplete fields as an autocomplete)
         */
        closed?: boolean
        /**
         * with `extra`: the typed text is sent once it has this many characters. Default 2
         */
        minChars?: number
        /**
         * `manual`: a closed field whose options cannot be loaded (the RESTAction fails, or answers an empty list) takes a typed value instead of blocking the form
         */
        fallback?: 'manual'
      }[]
      /**
       * custom labels and icons for form buttons
       */
      buttonConfig?: {
        /**
         * primary button configuration
         */
        primary?: {
          /**
           * text label for primary button
           */
          label?: string
          /**
           * icon name for primary button
           */
          icon?: string
          /**
           * when true, the primary button spans the whole action bar (antd Button `block`), with any other button stacked above it
           */
          block?: boolean
          /**
           * antd Button `size` of the primary button
           */
          size?: 'small' | 'middle' | 'large'
        }
        /**
         * secondary button configuration
         */
        secondary?: {
          /**
           * text label for secondary button
           */
          label?: string
          /**
           * icon name for secondary button
           */
          icon?: string
          /**
           * when set, the secondary button is a Cancel that navigates to this route (SPA) instead of resetting the form
           */
          navigateTo?: string
          /**
           * when true, the secondary button (Reset, or the Cancel of `navigateTo`) is not shown
           */
          hidden?: boolean
        }
        /**
         * draft button configuration — only rendered when widgetData.draftActionId is also set; clicking it persists the current (un-validated) field values via that action
         */
        draft?: {
          /**
           * text label for draft button
           */
          label?: string
          /**
           * icon name for draft button
           */
          icon?: string
        }
        /**
         * Configure-step button label when reviewBeforeSubmit is set (the button that opens the in-place Review; default 'Review →')
         */
        review?: {
          /**
           * text label for the Review button
           */
          label?: string
        }
        /**
         * Review-step back button label when reviewBeforeSubmit is set (returns to editing; default '← Back to edit')
         */
        reviewBack?: {
          /**
           * text label for the back-to-edit button
           */
          label?: string
        }
      }
      /**
       * boolean fields drawn as a Checkbox whose text is the field's label (its schema `title`, else its key), where a boolean is otherwise a Switch. The label is plain text; one phrase of it can be a link. A REQUIRED checkbox must be ticked to submit
       */
      checkboxes?: {
        /**
         * the dotted path of a boolean field; an entry naming any other field is ignored
         */
        name: string
        /**
         * one link in the label: the first occurrence of `text` in the label becomes a link to `href`, opened in a new tab (when `text` is not in the label, the link follows it)
         */
        link?: {
          /**
           * the phrase of the label that is the link
           */
          text: string
          /**
           * an http(s) or mailto URL, or a path on the portal (`/…`), with no whitespace or control characters; any other is not drawn as a link
           */
          href: string
        }
        /**
         * the message under a required checkbox left unticked
         */
        requiredMessage?: string
      }[]
      /**
       * Configuration for the form fields who are dependent from other form fields. The field options are set via an API call made using a RESTAction which sould be defined below. The RESTActions shuold contain a `status` field, which is an array of object with the `{ label, value }` format.
       */
      dependencies?: {
        /**
         * the field on which this field depends on
         */
        dependsOn: {
          /**
           * the name of the field on which this field depends on
           */
          name: string
        }
        /**
         * parameter to be added to the RESTAction call
         */
        extra: {
          /**
           * the key of the additional parameter
           */
          key: string
        }
        /**
         * the name of the autocomplete field
         */
        name: string
        /**
         * the identifier of the RESTAction that should be called to retrieve dependency data
         */
        resourceRefId: string
        /**
         * true: only a listed value is accepted (a select); false: the list suggests and typed text is kept. Default true (the previous frontend rendered dependent fields as a select)
         */
        closed?: boolean
        /**
         * `manual`: a closed field whose options cannot be loaded (the RESTAction fails, or answers an empty list) takes a typed value instead of blocking the form
         */
        fallback?: 'manual'
      }[]
      /**
       * antd Form disabled (disables all fields)
       */
      disabled?: boolean
      /**
       * Configuration for the form fields whose displaying is dependent from other form fields.
       */
      displayingDependencies?: {
        /**
         * the name of the field
         */
        name: string
        /**
         * the field on which this field depends on
         */
        dependsOn: {
          /**
           * the name of the field on which this field depends on
           */
          name: string
          /**
           * `notEmpty` (default) indicates that the current field is displayed if the dependency field has a non-empty value. `value` indicates that the current field is displayed only when the dependency field matches a specific value.
           */
          conditionType: 'notEmpty' | 'value'
          /**
           * Expected value used when `type = value`.
           */
          value?: {
            /**
             * Expected dependency value type.
             */
            type: 'string' | 'integer' | 'boolean' | 'array' | 'option' | 'null'
            /**
             * Value if type = string
             */
            stringValue?: string
            /**
             * Value if type = integer
             */
            integerValue?: number
            /**
             * Value if type = boolean
             */
            booleanValue?: boolean
            /**
             * Value if type = array
             */
            arrayValue?: string[]
            /**
             * Value if type = option: includes a single value or a { label, value } object
             */
            optionValue?: {
              /**
               * Label of the option
               */
              label?: string
              /**
               * Value of the option. A number or a boolean is compared with type integer or boolean.
               */
              value: string
            }
          }
        }
      }[]
      /**
       * optional id of an action fired by a 'Save draft' button that captures the CURRENT field values WITHOUT running form validation (so an incomplete form can be persisted). Pair with buttonConfig.draft to show the button.
       */
      draftActionId?: string
      /**
       * fields checked against a same-origin endpoint as they are typed: after typing pauses and on blur, the field's value (with `bodyExtras`) is POSTed as JSON and the answer becomes the field's validation status and message. A newer value aborts the check in flight; an answer for an old value is never applied. An empty value, or one failing the field's own rules, is not checked. While a check runs the field shows antd's validating spinner, and a submit waits for that answer
       */
      fieldChecks?: {
        /**
         * the dotted path of the field to check (a text-like field: not a boolean, object or list)
         */
        name: string
        /**
         * the same-origin path to POST JSON to. Sent through the page transport's allow-listed post: the path must be under one of the installation's PUBLIC_POST_PATHS, and no credential is ever sent (public page or signed in). Any other path is refused unsent
         */
        path: string
        /**
         * the body key the value is sent under; the last segment of `name` when absent
         */
        bodyKey?: string
        /**
         * body key → the name of one of the page's fragment extras (the keys its root declares in `krateo.io/fragment-keys`), e.g. `{ submission: s, token: t }`: those values are sent in the request BODY, never in a URL, and never enter the form. A key the page was not opened with is left out
         */
        bodyExtras?: {
          [k: string]: string
        }
        /**
         * how long typing must pause before the check is sent, in milliseconds; 500 when absent. Blur sends it at once
         */
        debounceMs?: number
        /**
         * the client timeout in milliseconds; 10000 when absent. A timeout is `otherwise`. Leave room for an endpoint that holds its answer
         */
        timeoutMs?: number
        /**
         * what each answer means for the field, tried in order (first match wins)
         */
        answers?: {
          /**
           * which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise`
           */
          when?: {
            /**
             * HTTP statuses, e.g. [429]
             */
            status?: number[]
            /**
             * a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals`
             */
            bodyField?: string
            /**
             * the values `bodyField` may hold for this entry to match
             */
            equals?: string[]
          }
          /**
           * the field's validation status for this answer (`warning` when absent). `error` blocks submitting, `warning` does not; `success` shows `message` as the field's help
           */
          validateStatus?: 'success' | 'warning' | 'error'
          /**
           * the message under the field; may name `{value}` (the checked value), `{body.<dotted>}` and `{retryAfter}`
           */
          message?: string
          /**
           * the message instead of `message` when the answer carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown
           */
          retryAfterMessage?: string
          /**
           * a dotted path into the response body naming a rule, e.g. `rule`; its `ruleMessages` entry replaces `message`
           */
          ruleFrom?: string
          /**
           * rule → message, for `ruleFrom`
           */
          ruleMessages?: {
            [k: string]: string
          }
          /**
           * an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup
           */
          result?: {
            /**
             * antd Result `status`
             */
            status: 'success' | 'info' | 'warning' | 'error'
            /**
             * antd Result `title`
             */
            title: string
            /**
             * antd Result `subTitle`
             */
            subtitle?: string
            /**
             * an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon
             */
            icon?: string
            /**
             * the Result's actions, in order
             */
            extra?: {
              /**
               * `button`: an antd primary Button; `link`: a plain link, after `text`
               */
              kind: 'button' | 'link'
              /**
               * the button's or the link's text
               */
              label: string
              /**
               * an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action
               */
              href: string
              /**
               * plain text before a `link`, e.g. `Already have an account?`
               */
              text?: string
            }[]
          }
        }[]
        /**
         * the answer for anything no entry matched, a network error and the timeout; when absent, a warning "We couldn't check this right now."
         */
        otherwise?: {
          /**
           * which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise`
           */
          when?: {
            /**
             * HTTP statuses, e.g. [429]
             */
            status?: number[]
            /**
             * a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals`
             */
            bodyField?: string
            /**
             * the values `bodyField` may hold for this entry to match
             */
            equals?: string[]
          }
          /**
           * the field's validation status for this answer (`warning` when absent). `error` blocks submitting, `warning` does not; `success` shows `message` as the field's help
           */
          validateStatus?: 'success' | 'warning' | 'error'
          /**
           * the message under the field; may name `{value}` (the checked value), `{body.<dotted>}` and `{retryAfter}`
           */
          message?: string
          /**
           * the message instead of `message` when the answer carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown
           */
          retryAfterMessage?: string
          /**
           * a dotted path into the response body naming a rule, e.g. `rule`; its `ruleMessages` entry replaces `message`
           */
          ruleFrom?: string
          /**
           * rule → message, for `ruleFrom`
           */
          ruleMessages?: {
            [k: string]: string
          }
          /**
           * an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup
           */
          result?: {
            /**
             * antd Result `status`
             */
            status: 'success' | 'info' | 'warning' | 'error'
            /**
             * antd Result `title`
             */
            title: string
            /**
             * antd Result `subTitle`
             */
            subtitle?: string
            /**
             * an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon
             */
            icon?: string
            /**
             * the Result's actions, in order
             */
            extra?: {
              /**
               * `button`: an antd primary Button; `link`: a plain link, after `text`
               */
              kind: 'button' | 'link'
              /**
               * the button's or the link's text
               */
              label: string
              /**
               * an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action
               */
              href: string
              /**
               * plain text before a `link`, e.g. `Already have an account?`
               */
              text?: string
            }[]
          }
        }
      }[]
      /**
       * help text shown UNDER a field's input (antd Form.Item `extra`), where it stays in view while a validation message shows above it. Plain text
       */
      fieldHelp?: {
        /**
         * the dotted path of a field (not an object or a list)
         */
        name: string
        /**
         * the help text
         */
        text: string
      }[]
      /**
       * a field's input: its placeholder, its HTML input type and its autocomplete token. `placeholder` applies to a text Input, a TextArea and a Select (in place of "Select…"); `type` and `autoComplete` to a text Input (`autoComplete` to a TextArea too). An entry naming a group, a list, a boolean, a number or a secret field is ignored
       */
      fieldInputs?: {
        /**
         * the input's `autocomplete` attribute: one autofill field name of the HTML standard (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill), or `on` / `off`. Credential and payment tokens are not offered: a secret field has its own
         */
        autoComplete?:
          | 'off'
          | 'on'
          | 'name'
          | 'honorific-prefix'
          | 'given-name'
          | 'additional-name'
          | 'family-name'
          | 'honorific-suffix'
          | 'nickname'
          | 'username'
          | 'organization-title'
          | 'organization'
          | 'street-address'
          | 'address-line1'
          | 'address-line2'
          | 'address-line3'
          | 'address-level4'
          | 'address-level3'
          | 'address-level2'
          | 'address-level1'
          | 'country'
          | 'country-name'
          | 'postal-code'
          | 'language'
          | 'bday'
          | 'bday-day'
          | 'bday-month'
          | 'bday-year'
          | 'sex'
          | 'url'
          | 'photo'
          | 'email'
          | 'impp'
          | 'tel'
          | 'tel-country-code'
          | 'tel-national'
          | 'tel-area-code'
          | 'tel-local'
          | 'tel-extension'
        /**
         * the dotted path of a field
         */
        name: string
        /**
         * the text the empty control shows
         */
        placeholder?: string
        /**
         * the text Input's HTML type: the keyboard a phone shows and what the browser offers to fill. The form's own rules still validate the value: with a `type`, the form turns off the browser's constraint validation (`novalidate`), so its errors show under the field like every other
         */
        type?: 'text' | 'email' | 'tel' | 'url'
      }[]
      /**
       * which fields of a schema form show antd's validation feedback icons. Absent: required fields. `rules`: every field with a validation rule, required or optional (an optional field shows the success icon only once it holds a value). `none`: no field, a `fieldChecks` field included
       */
      hasFeedback?: 'rules' | 'none'
      /**
       * optional object with initial values for form fields. Keys should match form field names (supports nested objects). These values override schema defaults.
       */
      initialValues?: Record<string, unknown>
      /**
       * resourceRefIds of form-control widgets (Input, Select, Switch, …) to compose inside the Form. Composable mode — an alternative to the schema/stringSchema generator.
       */
      items?: {
        /**
         * the identifier of the form-control widget to render
         */
        resourceRefId: string
      }[]
      /**
       * antd Form layout
       */
      layout?: 'horizontal' | 'vertical' | 'inline'
      /**
       * a message shown above the fields of a schema form (e.g. the blueprint formdef's note that the form was built from the CRD)
       */
      notice?: string
      /**
       * how `notice` is drawn: `alert` (absent), an info Alert; `text`, a line of secondary text. Either goes with the form when a Result replaces it
       */
      noticeVariant?: 'alert' | 'text'
      /**
       * configuration for object fields in the form
       */
      objectFields?: {
        /**
         * the path of the object field
         */
        path: string
        /**
         * the field to display in the objects list
         */
        displayField: string
      }[]
      /**
       * top-level schema property names to omit from the schema-driven form
       */
      propertiesToHide?: string[]
      /**
       * antd Form requiredMark. `optional`: required fields carry no mark and every other field reads "(optional)"; in a schema form the optional fields then render in place, in schema order, instead of in the "Advanced" collapse. Absent: required fields are marked with an asterisk. `hidden`: no field carries a mark, required or not (antd `requiredMark={false}`)
       */
      requiredMark?: 'optional' | 'hidden'
      /**
       * when true (inline render only), the primary button validates and reveals an in-place read-only Review of the entered values before the real submit — the form stays mounted so 'Back to edit' preserves every value. Pair with buttonConfig.review / buttonConfig.reviewBack for custom labels.
       */
      reviewBeforeSubmit?: boolean
      /**
       * JSON schema (e.g. a blueprint CRD's openAPIV3Schema spec) rendered as form fields — the schema-driven alternative to `items`. Usually populated server-side via a widgetDataTemplate jq expression that extracts the spec schema. Note: a schema sourced from a CRD's openAPIV3Schema has its `properties` map serialized alphabetically (order lost); use `stringSchema` to preserve the source values.schema.json authoring order.
       */
      schema?: Record<string, unknown>
      /**
       * antd Form size
       */
      size?: 'small' | 'middle' | 'large'
      /**
       * Same JSON schema as `schema`, but as a raw JSON STRING. Preferred over `schema` when present: the client JSON.parses it, preserving key insertion order, so fields render in the source values.schema.json order rather than the alphabetized order a CRD-sourced object schema yields. Typically populated server-side from the blueprint's per-version jsonschema ConfigMap (which keeps authoring order). Falls back to `schema` when absent or not valid JSON.
       */
      stringSchema?: string
      /**
       * the id of the action to be called when the form is submitted. A Form submits EITHER through `actions` + `submitActionId` OR through `submitPost`; with neither or both it renders an error
       */
      submitActionId?: string
      /**
       * optional field-conditional submit routing: when present, the submit action is chosen at submit time from the value of the named field. Routes one form to different create targets (e.g. a 'target cluster' select where 'local' posts the blueprint instance and a remote spoke posts a RemoteInstall). Falls back to `default` (or `submitActionId`) when the field value has no mapping.
       */
      submitActionSelector?: {
        /**
         * form field whose current value selects the submit action
         */
        field: string
        /**
         * map of field-value → action id
         */
        map: {
          [k: string]: string
        }
        /**
         * action id used when the field value is not present in `map`
         */
        default?: string
      }
      /**
       * when true, the primary (submit) button stays disabled until at least one field differs from its initial value (initialValues overlaid on schema defaults). Use for update forms where submitting an unchanged value is a no-op — e.g. a version picker pre-set to the currently-installed version.
       */
      submitDisabledWhenPristine?: boolean
      /**
       * submit by POSTing the form's values as JSON to an allow-listed same-origin path, instead of a snowplow write through `actions`/`submitActionId` (a Form has exactly one of the two). While it is in flight the form is disabled and the primary button loading. Each response is mapped to a `result` (replaces the form), `fieldErrors` or an inline `alert`; when an entry sets several, `result` wins, then `fieldErrors`
       */
      submitPost?: {
        /**
         * the same-origin path to POST JSON to. Sent through the page transport's allow-listed post: the path must be under one of the installation's PUBLIC_POST_PATHS, and no credential is ever sent (public page or signed in). Any other path is refused unsent
         */
        path: string
        /**
         * body key → the name of one of the page's fragment extras (the keys its root declares in `krateo.io/fragment-keys`), e.g. `{ submission: s, token: t }`: those values are sent in the request BODY, never in a URL, and never enter the form. A key the page was not opened with is left out
         */
        bodyExtras?: {
          [k: string]: string
        }
        /**
         * the client timeout in milliseconds; 10000 when absent. A timeout is `otherwise`. Leave room for an endpoint that holds its answer
         */
        timeoutMs?: number
        /**
         * what each response means, tried in order (first match wins)
         */
        responses?: {
          /**
           * which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise`
           */
          when?: {
            /**
             * HTTP statuses, e.g. [429]
             */
            status?: number[]
            /**
             * a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals`
             */
            bodyField?: string
            /**
             * the values `bodyField` may hold for this entry to match
             */
            equals?: string[]
          }
          /**
           * an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup
           */
          result?: {
            /**
             * antd Result `status`
             */
            status: 'success' | 'info' | 'warning' | 'error'
            /**
             * antd Result `title`
             */
            title: string
            /**
             * antd Result `subTitle`
             */
            subtitle?: string
            /**
             * an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon
             */
            icon?: string
            /**
             * the Result's actions, in order
             */
            extra?: {
              /**
               * `button`: an antd primary Button; `link`: a plain link, after `text`
               */
              kind: 'button' | 'link'
              /**
               * the button's or the link's text
               */
              label: string
              /**
               * an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action
               */
              href: string
              /**
               * plain text before a `link`, e.g. `Already have an account?`
               */
              text?: string
            }[]
          }
          /**
           * errors on the fields the response names. A field's message is `ruleMessages[<the body's ruleFrom>]`, else `fieldMessages[<field>]`, else `message`, else "Check this field.". Names the form does not have are ignored; if none is left, `message` shows as an error Alert
           */
          fieldErrors?: {
            /**
             * dotted field paths, always named
             */
            names?: string[]
            /**
             * a dotted path into the response body holding an array of field names, e.g. `fields`
             */
            namesFrom?: string
            /**
             * a dotted path into the response body naming a rule, e.g. `rule`
             */
            ruleFrom?: string
            /**
             * rule → message
             */
            ruleMessages?: {
              [k: string]: string
            }
            /**
             * field (dotted path) → message
             */
            fieldMessages?: {
              [k: string]: string
            }
            /**
             * the message for a field with no other
             */
            message?: string
          }
          /**
           * an antd Alert directly above the form's buttons (not a toast); cleared when the next submit starts. Strings may name `{body.<dotted>}` and `{retryAfter}`
           */
          alert?: {
            /**
             * antd Alert `type`
             */
            type: 'warning' | 'error' | 'info'
            /**
             * antd Alert `title`
             */
            title: string
            /**
             * antd Alert `description`
             */
            description?: string
            /**
             * the description instead of `description` when the response carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown
             */
            retryAfterDescription?: string
          }
        }[]
        /**
         * the outcome for anything no entry matched, a network error and the timeout; when absent, an error Alert "We couldn't send this form."
         */
        otherwise?: {
          /**
           * an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup
           */
          result?: {
            /**
             * antd Result `status`
             */
            status: 'success' | 'info' | 'warning' | 'error'
            /**
             * antd Result `title`
             */
            title: string
            /**
             * antd Result `subTitle`
             */
            subtitle?: string
            /**
             * an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon
             */
            icon?: string
            /**
             * the Result's actions, in order
             */
            extra?: {
              /**
               * `button`: an antd primary Button; `link`: a plain link, after `text`
               */
              kind: 'button' | 'link'
              /**
               * the button's or the link's text
               */
              label: string
              /**
               * an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action
               */
              href: string
              /**
               * plain text before a `link`, e.g. `Already have an account?`
               */
              text?: string
            }[]
          }
          /**
           * errors on the fields the response names. A field's message is `ruleMessages[<the body's ruleFrom>]`, else `fieldMessages[<field>]`, else `message`, else "Check this field.". Names the form does not have are ignored; if none is left, `message` shows as an error Alert
           */
          fieldErrors?: {
            /**
             * dotted field paths, always named
             */
            names?: string[]
            /**
             * a dotted path into the response body holding an array of field names, e.g. `fields`
             */
            namesFrom?: string
            /**
             * a dotted path into the response body naming a rule, e.g. `rule`
             */
            ruleFrom?: string
            /**
             * rule → message
             */
            ruleMessages?: {
              [k: string]: string
            }
            /**
             * field (dotted path) → message
             */
            fieldMessages?: {
              [k: string]: string
            }
            /**
             * the message for a field with no other
             */
            message?: string
          }
          /**
           * an antd Alert directly above the form's buttons (not a toast); cleared when the next submit starts. Strings may name `{body.<dotted>}` and `{retryAfter}`
           */
          alert?: {
            /**
             * antd Alert `type`
             */
            type: 'warning' | 'error' | 'info'
            /**
             * antd Alert `title`
             */
            title: string
            /**
             * antd Alert `description`
             */
            description?: string
            /**
             * the description instead of `description` when the response carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown
             */
            retryAfterDescription?: string
          }
        }
      }
      /**
       * a static, open catalogue for a field: the options are offered, and any typed value is kept
       */
      suggestions?: {
        /**
         * the name of the field
         */
        name: string
        /**
         * the catalogue, in the order it is shown
         */
        options: {
          /**
           * the value written into the field
           */
          value: string
          /**
           * shown instead of the value
           */
          label?: string
          /**
           * a muted second line
           */
          description?: string
          /**
           * the heading the option is grouped under
           */
          group?: string
        }[]
      }[]
      /**
       * string fields drawn as a multi-line TextArea instead of a one-line Input. An entry naming a field that is not a string, or that has an `enum` or a `oneOf`, is ignored
       */
      textareas?: {
        /**
         * the dotted path of a string field
         */
        name: string
        /**
         * the TextArea's height in rows; 3 when absent
         */
        rows?: number
      }[]
      /**
       * a heading above the form's fields. It goes with the form when a `submitPost` or `fieldChecks` result replaces it, so a page's heading can live in the Form
       */
      title?: string
      /**
       * the messages a field's validation shows, in place of the generated ones. A checkbox has its own, in `checkboxes`
       */
      validationMessages?: {
        /**
         * the dotted path of a field
         */
        name: string
        /**
         * shown when the field is required and left empty, in place of "<Label> is required"
         */
        requiredMessage?: string
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
