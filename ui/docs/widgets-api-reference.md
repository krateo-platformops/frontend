---
type: API
title: frontend — widgets API reference
description: Generated per-widget reference of every widget kind's widgetData schema; regenerated from src/widgets/*/*.schema.json by `npm run update-readme-widgets`.
resource: oci://ghcr.io/krateo-platformops/charts/frontend-crds
tags: [widgets, generated]
timestamp: 2026-08-07T00:00:00Z
---

# Widgets API reference

Generated from each widget's `src/widgets/<Kind>/<Kind>.schema.json` (the CRD source of
truth) by `npm run update-readme-widgets` — do not edit the section below by hand; the
generator preserves this header and rewrites everything from the `## Widgets

List of implemented widgets:

### Alert

Alert displays an inline contextual message

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| title | yes | the alert title. A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"). Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| description | no | the alert detail text. A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"). Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| type | no | the alert severity | `success` \| `info` \| `warning` \| `error` |
| showIcon | no | whether to show the severity icon | boolean |
| banner | no | render as a full-width banner | boolean |
| closable | no | whether the alert can be dismissed | boolean |


[Examples](../src/examples/widgets/Alert/Alert.example.yaml)

---

### Badge

Badge shows a small count or status dot

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| count | no | the number shown in the badge | integer |
| text | no | the text shown next to a status dot | string |
| status | no | the status style | `success` \| `processing` \| `default` \| `error` \| `warning` |
| showZero | no | whether to show the badge when count is zero | boolean |
| dot | no | render a dot instead of a count | boolean |


[Examples](../src/examples/widgets/Badge/Badge.example.yaml)

---

### BarChart

BarChart wraps the @ant-design/charts Column component (AntV G2 — vertical bars). It mirrors that library's data + field-mapping API.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| data | yes | chart data records (G2 `data`) | array |
| xField | yes | field mapped to the category axis (G2 `xField`) | string |
| yField | yes | field mapped to the value axis (G2 `yField`) | string |
| xTimeUnit | no | When set, `xField` values are UNIX epoch SECONDS, one bar per bucket in the order sent, labelled in the VIEWER's time zone as all text is: 'hour' -> the clock ('14:00'), the day named where it changes ('25 Nov', or '25 Nov, 01:00' when the bucket is not at midnight); 'day' -> the day ('24 Nov'; '31 Dec 2025' in another year). The tooltip gives the bar's full date with the zone ('Tue 24 November 2026, 14:00:00 (UTC+1)'). Use this instead of server-side strftime, which is UTC: a chart an hour apart from the text beside it. | `hour` \| `day` |
| slotField | no | The row field that says a slot is not a whole measurement: `partial` for the slot still filling (the one that holds now), `missing` for a slot where nothing was recorded (send its value as null, never 0). Any other value, or none, is a whole slot. A bar still filling is drawn as a faint fill inside a dashed outline in its series colour, and its hover value ends 'so far'; a slot with no data draws no bar but a hatched band labelled 'No data', whose hover reads 'No data · 25 Nov, 09:00 to 10:00'. A legend entry 'so far' or 'no data' is added under the chart only when such a slot is drawn. A band is drawn only where every series of the slot has no data. Independently of this field, a measured 0 (in a slot that is not missing) is a 2px hairline on the baseline in the neutral grey, so a zero reads as measured and is never painted in a series colour. | string |
| colorField | no | field mapped to color / series (G2 `colorField`) | string |
| stack | no | stack series sharing an x value (G2 `stack`) | boolean |
| group | no | group series side-by-side at each x value (G2 `group`) | boolean |
| legend | no | show the legend; false hides it (G2 `legend`) | boolean |
| title | no | chart title (G2 `title`) | string |
| height | no | fixed height in px (G2 `height`); omit to autofit | integer |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/BarChart/BarChart.example.yaml)

---

### Breadcrumb

Breadcrumb wraps the Ant Design Breadcrumb component: an ordered list of crumbs, each an optional link.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| items | yes | antd Breadcrumb `items` | array |
| items[].title | yes | crumb label (antd Breadcrumb ItemType.title) | string |
| items[].href | no | optional link target (antd Breadcrumb ItemType.href) | string |
| separator | no | antd Breadcrumb `separator` (default "/") | string |


[Examples](../src/examples/widgets/Breadcrumb/Breadcrumb.example.yaml)

---

### Button

Button represents an interactive component which, when clicked, triggers a specific business logic defined by its `clickActionId`

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| actions | yes | the actions of the widget | object |
| actions.rest | no | rest api call actions triggered by the widget | array |
| actions.rest[].id | yes | unique identifier for the action | string |
| actions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| actions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| actions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| actions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| actions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| actions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| actions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| actions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| actions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| actions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| actions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| actions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| actions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| actions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate[].path | no | the identifier of the route to navigate to | string |
| actions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| actions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| actions.navigate[].type | yes | type of navigation action | `navigate` |
| actions.openDrawer | no | actions to open side drawer components | array |
| actions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| actions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| actions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| actions.openDrawer[].title | no | title shown in the drawer header | string |
| actions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| color | no | antd Button color (pair with `variant`). NOTE: these are antd's OWN presets, not the Krateo palette — `default`/`primary`/`danger` are not colours at all, and `green`/`blue`/`red`/`orange` render antd's shades, NOT the brand ones a Table column or a Tag would give for the same name. Krateo palette names (`darkBlue`, `gray`, `violet`) are not valid here. | `default` \| `primary` \| `danger` \| `blue` \| `purple` \| `cyan` \| `green` \| `magenta` \| `pink` \| `red` \| `orange` \| `yellow` \| `volcano` \| `geekblue` \| `lime` \| `gold` |
| variant | no | antd Button variant (pair with `color`) | `outlined` \| `dashed` \| `solid` \| `filled` \| `text` \| `link` |
| danger | no | antd Button danger. Design rule C26: set it on a button that DELETES content (Delete, Remove, Discard) | boolean |
| intent | no | Krateo button role, not an antd prop (design rules C26, A4). `dismiss`: the button closes or backs out without deleting anything (Cancel, Close) and is drawn as the neutral default outline; `type`, `color`, `variant` and `danger` are ignored. A button that deletes content uses `danger` instead. `agentiko`: the button opens the Agentiko agent with a seeded prompt (a `?ask=` link; label it `Ask Agentiko →`) and is drawn filled with the Agentiko gradient and mark, or outlined with a lock when the agent is not licensed; `type`, `color`, `variant`, `danger`, `ghost` and `icon` are ignored | `dismiss` \| `agentiko` |
| disabled | no | antd Button disabled | boolean |
| block | no | antd Button block (full width) | boolean |
| ghost | no | antd Button ghost | boolean |
| label | no | the label of the button | string |
| ariaLabel | no | WCAG accessible name for icon-only buttons (no visible label). When the button renders only an icon, the browser needs a text alternative for screen readers. Provide a short human-readable description (e.g. "Delete", "Refresh"). Falls back to the action id when omitted. | string |
| icon | no | the icon of the button (font awesome icon name eg: `fa-inbox`) | string |
| iconColor | no | palette color name (e.g. green / orange / red / cyan) applied to the icon independently of the button color — e.g. a leading fa-circle status dot on a filter chip | string |
| shape | no | the shape of the button | `default` \| `circle` \| `round` |
| size | no | the size of the button | `small` \| `middle` \| `large` |
| type | no | the visual style of the button | `default` \| `text` \| `link` \| `primary` \| `dashed` |
| clickActionId | yes | the id of the action to be executed when the button is clicked | string |


[Examples](../src/examples/widgets/Button/Button.example.yaml)

---

### ButtonGroup

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| alignment | no | the alignment of the element inside the ButtonGroup. Default is 'left' | `center` \| `left` \| `right` |
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| size | no | antd Space size — spacing between items | `small` \| `middle` \| `large` |
| orientation | no | antd Space orientation | `horizontal` \| `vertical` |
| wrap | no | antd Space wrap | boolean |
| items | yes | the items of the ButtonGroup | array |
| items[].resourceRefId | yes | Handle of the child to render here, matching an `id` in spec.resourcesRefs. | string |


[Examples](../src/examples/widgets/ButtonGroup/ButtonGroup.example.yaml)

---

### Card

Card is a container to display information

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| afterCard | no | children of the card (by `resourceRefId`, among `items`) that render just after the card instead of in its body, in `items` order — one placement, so the reading order is the body, then these. The card and these form a column that takes `centered` and `maxWidth`. On a `brand` + `centered` + `maxWidth` card, at 480px and under the column is one surface the screen's height and these are its last row (inside the card's surface, as the sign-in card's "Need access?" line); on any other card they render after the card at every width. An entry naming no item is ignored | array |
| afterCard[].resourceRefId | yes | the resourceRefId of one of the card's `items` | string |
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| anchorId | no | renders this panel with a DOM id so an in-page `[text](#anchorId)` link (e.g. a summary/table-of-contents Markdown widget) scrolls to it | string |
| brand | no | draws the sign-in card's brand: the brand band with the logo across the top of the card (above any `cover`), the sign-in card's radius, elevation and body padding, and the installation line ("to Krateo PlatformOps · <installation>") under the heading of the content — the `title` of a Form in the card — so the line goes with that heading when a Result replaces the form. The logo and the installation's name come from the frontend's own config (`login.logoUrl`, `login.logoAlt`, `login.installationName`), never from the CR | boolean |
| centered | no | centres the card horizontally in its container; with `maxWidth`, a narrow centred column | boolean |
| clickActionId | no | the id of the action to be executed when the panel is clicked | string |
| cover | no | resourceRefId of a widget rendered as the antd Card cover | string |
| extra | no | antd Card extra — content shown top-right of the card header (renamed from `headerRight`). A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"). Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| extraRefId | no | resourceRefId of a widget (e.g. a Button) rendered top-right of the card header — a real, independently-actioned slot with its own icon/size/navigation, distinct from the plain-text `extra`. Mirrors the `cover`/`footer` widget slots; renders a nested WidgetRenderer, so it does NOT make the whole card the click target the way `extra` + `clickActionId` does. | string |
| extraStatus | no | colour token: antd Badge status for `extraVariant: badge`; antd Tag color for `extraVariant: tag` | `success` \| `processing` \| `warning` \| `error` \| `default` \| `green` \| `gold` \| `red` \| `blue` \| `violet` |
| extraVariant | no | how `extra` renders top-right: `text` (default, plain), `badge` (glow dot + uppercase mono, for CONVERGED/DRIFT/DEGRADED), or `tag` (soft antd Tag pill — for Up to date / status labels) | `text` \| `badge` \| `tag` |
| footer | no | footer section of the panel containing additional items | array |
| footer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented, usually a widget | string |
| headerLeft | no | optional text to be displayed under the title, on the left side of the Card | string |
| icon | no | icon displayed in the panel header | object |
| icon.name | yes | name of the icon to display (font awesome icon name eg: `fa-inbox`) | string |
| icon.color | no | color of the icon | string |
| items | yes | list of resource references to display as main content in the panel | array |
| items[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented, usually a widget | string |
| legend | no | optional legend key shown top-right of the card header (e.g. the reconciliation-rail actual/drift/target swatches): each item is a small colour swatch + label | array |
| legend[].color | yes | swatch colour (palette name, e.g. cyan / magenta / amber) | string |
| legend[].label | yes | swatch label (e.g. actual / drift / target) | string |
| live | no | show a pulsing "Live" badge next to the card title (for cards backed by a live/SSE feed) | boolean |
| maxWidth | no | the widest the card grows, in pixels; it fills its container up to that width. Absent: it fills its container | integer |
| size | no | antd Card size | `default` \| `small` |
| tags | no | list of string tags to be displayed in the footer | array |
| title | no | text to be displayed as the panel title | string |
| titleVariant | no | how the panel title is rendered. 'heading' (default) = readable card heading (marketplace tiles, detail headers). 'eyebrow' = small mono uppercase letter-spaced muted caption (flight-deck section/panel labels). | `heading` \| `eyebrow` |
| tooltip | no | optional tooltip text shown on the top right side of the card to provide additional context | string |
| variant | no | antd Card variant | `outlined` \| `borderless` |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |
| widgetActions | no | the Krateo event actions of the widget (renamed from `actions`, which collides with antd Card.actions) | object |
| widgetActions.rest | no | rest api call actions triggered by the widget | array |
| widgetActions.rest[].id | yes | unique identifier for the action | string |
| widgetActions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| widgetActions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| widgetActions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| widgetActions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| widgetActions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| widgetActions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| widgetActions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| widgetActions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| widgetActions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| widgetActions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| widgetActions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| widgetActions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| widgetActions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| widgetActions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| widgetActions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| widgetActions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| widgetActions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| widgetActions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| widgetActions.rest[].type | yes | type of action to execute | `rest` |
| widgetActions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| widgetActions.rest[].payload | no | static payload sent with the request | object |
| widgetActions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| widgetActions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| widgetActions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| widgetActions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| widgetActions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| widgetActions.navigate | no | client-side navigation actions | array |
| widgetActions.navigate[].id | yes | unique identifier for the action | string |
| widgetActions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| widgetActions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| widgetActions.navigate[].path | no | the identifier of the route to navigate to | string |
| widgetActions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| widgetActions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| widgetActions.navigate[].type | yes | type of navigation action | `navigate` |
| widgetActions.openDrawer | no | actions to open side drawer components | array |
| widgetActions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| widgetActions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| widgetActions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| widgetActions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| widgetActions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| widgetActions.openDrawer[].title | no | title shown in the drawer header | string |
| widgetActions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| widgetActions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| widgetActions.openModal | no | actions to open modal dialog components | array |
| widgetActions.openModal[].id | yes | unique identifier for the modal action | string |
| widgetActions.openModal[].type | yes | type of modal action | `openModal` |
| widgetActions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| widgetActions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| widgetActions.openModal[].title | no | title shown in the modal header | string |
| widgetActions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| widgetActions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| widgetActions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| widgetActions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |


[Examples](../src/examples/widgets/Card/Card.example.yaml)

---

### Checkbox

Checkbox is a form-control widget wrapping Ant Design Checkbox.Group (multi-select). It renders inside a Form widget's context and binds its value (array) by `name`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule | boolean |
| defaultValue | no | initially-checked values — antd Form.Item `initialValue` | array |
| options | yes | antd Checkbox.Group `options` | array |
| options[].label | no | option label (defaults to value) | string |
| options[].value | yes | option value | string |
| options[].disabled | no | antd option `disabled` | boolean |
| disabled | no | antd Checkbox.Group `disabled` | boolean |


[Examples](../src/examples/widgets/Checkbox/Checkbox.example.yaml)

---

### Col

Col is a layout component that arranges its children in a vertical stack, aligning them one above the other with spacing between them

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| items | yes | the items of the column | array |
| items[].resourceRefId | yes | the identifier of the k8s Custom Resource that should be represented, usually a widget | string |
| span | no | antd Col span — cells occupied, 0 (hidden) to 24 (full width). Renamed from `size`, which is still accepted. | integer |
| offset | no | antd Col offset | integer |
| order | no | antd Col order | integer |
| flex | no | antd Col flex | string |
| xs | no | antd Col xs span | integer |
| sm | no | antd Col sm span | integer |
| md | no | antd Col md span | integer |
| lg | no | antd Col lg span | integer |
| xl | no | antd Col xl span | integer |
| xxl | no | antd Col xxl span | integer |


[Examples](../src/examples/widgets/Col/Col.example.yaml)

---

### Collapse

Collapse renders a list of collapsible panels, following the Ant Design Collapse API (items, defaultActiveKey, accordion, bordered, ghost, size). The panels come from data, so a page can show one per group it does not know in advance (one per alert, per repo, per day). Each panel's body is a child widget (resourceRefId) or a dataSource rendered through the same list rows Listy draws (itemTemplate, grid), optionally capped to its first N items with a footer link.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| items | yes | antd Collapse `items`: the panels, in order. | array |
| items[].key | no | antd Collapse item `key`: unique among the panels; what defaultActiveKey names. Absent, the panel's resourceRefId, else its position ("0", "1", ...). | string |
| items[].label | no | antd Collapse item `label`: the panel's title. Absent, the header shows only the count and extra (a panel dropped into a Collapse in the Page Builder starts that way, before it is given a title). | string |
| items[].count | no | how many items the panel holds, drawn as a count badge after the title and read as part of the header's accessible name. Absent, no badge. | integer |
| items[].status | no | exception-only tint for the count badge (antd Tag status colours): `error` for a panel that holds something broken, `warning` for one that needs attention. Absent, the badge is neutral, as a healthy panel's should be. A panel with a status is also open by default when defaultActiveKey is absent. | `error` \| `warning` |
| items[].extra | no | antd Collapse item `extra`: muted header meta drawn at the header's end, e.g. "12 alerts, largest first". | string |
| items[].collapsible | no | antd Collapse item `collapsible`: what toggles the panel (the whole header by default). | `header` \| `icon` \| `disabled` |
| items[].resourceRefId | no | a STATIC body: the child widget to render in the panel, matching an `id` in spec.resourcesRefs. It is fetched the first time the panel opens. Takes precedence over dataSource. | string |
| items[].dataSource | no | a DATA body: the panel's items, each rendered through widgetData.itemTemplate exactly as a Listy row (or card, chip, statistic) is. | array |
| items[].cap | no | draw only the first `cap` items of dataSource. With cap set, the footer is drawn only when dataSource holds more than cap items; without it, the footer is drawn whenever it is set (a list capped server-side). | integer |
| items[].footer | no | text under the panel's dataSource body, e.g. "See all 37 →" (antd List footer). | string |
| items[].footerNavigateTo | no | in-app route the footer opens (e.g. the table view filtered to this group); when set the footer renders as a link. | string |
| defaultActiveKey | no | antd Collapse `defaultActiveKey`: the keys of the panels open on first render. Absent, every panel with a `status` starts open and the rest start folded (exception groups open, settled ones folded). | array |
| accordion | no | antd Collapse `accordion`: at most one panel open at a time. | boolean |
| bordered | no | antd Collapse `bordered`. | boolean |
| ghost | no | antd Collapse `ghost`: borderless, transparent panels. | boolean |
| size | no | antd Collapse `size`. | `small` \| `middle` \| `large` |
| itemTemplate | no | serializable substitute for antd renderItem: maps a data element's fields to row slots ({dot.path}; {a|b} first-non-empty) | object |
| itemTemplate.primaryText | no | {dot.path} to the row's main label. | string |
| itemTemplate.secondaryText | no | {dot.path} to the value shown opposite the primary text. | string |
| itemTemplate.subPrimaryText | no | {dot.path} to the line beneath the primary text. | string |
| itemTemplate.subSecondaryText | no | {dot.path} to the line beneath the secondary text. | string |
| itemTemplate.description | no | longer body line (2-line clamp); only rendered by the card rowVariant (e.g. a catalog tile description) | string |
| itemTemplate.cardCta | no | card-footer call-to-action cue (e.g. "Configure") shown footer-left when a card rowVariant is clickable (navigateTo); rendered as mono amber text + a sliding arrow (a navigation hint, not a button) | string |
| itemTemplate.icon | no | {dot.path} to an icon name, or a literal name, shown at the row leading edge. | string |
| itemTemplate.iconVariant | no | leading-indicator style: avatar (solid disc + glyph, default), tile (soft-tint rounded square + glyph), dot (small status dot + halo) | `avatar` \| `tile` \| `dot` |
| itemTemplate.rowVariant | no | row layout: default (antd List.Item.Meta — avatar + stacked title/description) | tree (tight single-line mono Relations row: connector + status dot + primaryText + muted inline subPrimaryText + right-aligned colored secondaryText) | card (full antd Card tile — icon-tile + name + version badge (subPrimaryText) + category tag (secondaryText) + description + a footer of rowActions as visible buttons — the Marketplace catalog grid) | chip (compact navigable filter pill — primaryText label + optional count, solid/amber when the item's active flag is set — the data-driven Marketplace facet chips; a chip whose data element carries `removable: true` is an applied filter: a trailing remove mark, the accessible name "Remove filter: <primaryText>", and its navigateTo is the URL without that value) | statistic (one tile of a stats strip: an antd Card holding an antd Statistic, primaryText the title, secondaryText the value, subPrimaryText a secondary caption; `color` tints the value and frame ONLY when it resolves, so the healthy majority stays neutral; without `grid` the tiles fill the row and reflow as it narrows) | `default` \| `tree` \| `card` \| `chip` \| `statistic` |
| itemTemplate.secondaryTextAsTag | no | render secondaryText as a soft-tint Tag pill (e.g. a category) instead of plain text | boolean |
| itemTemplate.subPrimaryTextMono | no | render subPrimaryText as a small mono bordered pill (e.g. an event involvedObject Kind/name ref) instead of plain sub-text | boolean |
| itemTemplate.ellipsis | no | one line each for primaryText and subPrimaryText in the default row, the full text in a tooltip (antd Typography ellipsis) | boolean |
| itemTemplate.navigateTo | no | per-item navigation target ({dot.path} template, e.g. {link}); when it resolves non-empty the row becomes clickable and navigates there (SPA route) | string |
| itemTemplate.color | no | Resolves the row's accent colour per item, so colour carries meaning from the data rather than being fixed by the author. | object |
| itemTemplate.color.value | no | {dot.path} to the value the colour is chosen from. | string |
| itemTemplate.color.map | no | Maps a resolved value to a colour token, for example `Ready` to green. | object |
| itemTemplate.color.default | no | Colour used when the resolved value is absent from the map. | string |
| itemTemplate.status | no | an at-a-glance status indicator (a Font Awesome glyph) rendered top-right of the `card` rowVariant. Each field is a {dot.path} resolved per item; the raw-value -> glyph/colour mapping is computed server-side (jq in the RESTAction), so the widget stays strongly typed. E.g. a blueprint's CompositionDefinition Ready condition resolved to {readyIcon}/{readyColor}/{readyReason}. | object |
| itemTemplate.status.icon | no | {dot.path} to the resolved Font Awesome icon name (e.g. {readyIcon}) | string |
| itemTemplate.status.color | no | {dot.path} to the resolved palette colour (e.g. {readyColor}) | string |
| itemTemplate.status.tooltip | no | {dot.path} tooltip text shown on hover (e.g. {readyReason}) | string |
| itemTemplate.bar | no | per-row horizontal Progress bar (the reconciliation-rail row): an antd Progress line whose percent + stroke colour are resolved per item | object |
| itemTemplate.bar.percent | no | {dot.path} to a 0-100 number (e.g. {healthPercent}) | string |
| itemTemplate.bar.color | no | Resolves the bar's stroke colour per item. | object |
| itemTemplate.bar.color.value | no | {dot.path} to the value the stroke colour is chosen from. | string |
| itemTemplate.bar.color.map | no | Maps a resolved value to a stroke colour token. | object |
| itemTemplate.bar.color.default | no | Stroke colour used when the resolved value is absent from the map. | string |
| itemTemplate.bar.label | no | optional trailing {dot.path} label (e.g. the % text or 7/7) | string |
| itemTemplate.bar.tooltip | no | {dot.path} tooltip text shown when the bar's label is hovered or focused (e.g. {rail.reason}). Resolving to empty leaves the label without a tooltip. | string |
| itemTemplate.bar.variant | no | Bar style: `line` for a standalone progress line, `rail` for the denser reconciliation-rail treatment. | `line` \| `rail` |
| itemTemplate.formats | no | Per-field rendering applied after each {dot.path} resolves. | object |
| itemTemplate.formats.primaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.secondaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.subPrimaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.subSecondaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.rowActions | no | per-row action controls rendered on each row as a kebab (⋯) menu or as buttons (see rowActionsDisplay); each entry references an action id from widgetData.actions and is fired with the row's data as the action payload (customPayload). Distinct from navigateTo (whole-row click). | array |
| itemTemplate.rowActions[].actionId | yes | id of an action defined in widgetData.actions to fire when this menu item is clicked | string |
| itemTemplate.rowActions[].label | yes | menu item label | string |
| itemTemplate.rowActions[].icon | no | optional Font Awesome icon name for the menu item | string |
| itemTemplate.rowActions[].danger | no | render the menu item in a destructive (red) style | boolean |
| itemTemplate.rowActions[].type | no | the button's emphasis where row actions show as buttons (a List card footer, or rowActionsDisplay: buttons). Unset: the first action is primary and the rest default. Set default on the first to have no primary. Ignored in the kebab menu. | `primary` \| `default` |
| itemTemplate.rowActionsDisplay | no | how the default rowVariant presents rowActions: menu (a kebab (⋯) at the row's end, default) | buttons (antd Buttons at the row's end, in declared order: the first primary, the rest default, a danger entry as danger). The whole-row click (navigateTo) is unchanged either way. The card rowVariant always renders buttons. | `menu` \| `buttons` |
| grid | no | antd List grid layout (ListGridType); presence enables grid mode | object |
| grid.gutter | no | Spacing between grid columns, in pixels. Mirrors antd List `grid.gutter`. | integer |
| grid.column | no | Number of columns at the default breakpoint. Mirrors antd List `grid.column`. | integer |
| grid.xs | no | Number of columns at the extra-small breakpoint. Mirrors antd List `grid.xs`. | integer |
| grid.sm | no | Number of columns at the small breakpoint. Mirrors antd List `grid.sm`. | integer |
| grid.md | no | Number of columns at the medium breakpoint. Mirrors antd List `grid.md`. | integer |
| grid.lg | no | Number of columns at the large breakpoint. Mirrors antd List `grid.lg`. | integer |
| grid.xl | no | Number of columns at the extra-large breakpoint. Mirrors antd List `grid.xl`. | integer |
| grid.xxl | no | Number of columns at the extra-extra-large breakpoint. Mirrors antd List `grid.xxl`. | integer |
| actions | no | the actions of the widget (canonical map; see src/schemas/actions.schema.json). Referenced per-row by itemTemplate.rowActions in the panels' dataSource bodies. | object |
| actions.rest | no | rest api call actions triggered by the widget | array |
| actions.rest[].id | yes | unique identifier for the action | string |
| actions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| actions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| actions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| actions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| actions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| actions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| actions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| actions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| actions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| actions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| actions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| actions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| actions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| actions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate[].path | no | the identifier of the route to navigate to | string |
| actions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| actions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| actions.navigate[].type | yes | type of navigation action | `navigate` |
| actions.openDrawer | no | actions to open side drawer components | array |
| actions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| actions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| actions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| actions.openDrawer[].title | no | title shown in the drawer header | string |
| actions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |


[Examples](../src/examples/widgets/Collapse/Collapse.example.yaml)

---

### DatePicker

DatePicker is a form-control widget wrapping Ant Design DatePicker. It renders inside a Form widget's context and binds its value by `name`. Values are ISO date strings (converted to/from Day.js).

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule | boolean |
| defaultValue | no | initial date as an ISO string (parsed via Day.js into Form.Item `initialValue`) | string |
| placeholder | no | antd DatePicker `placeholder` | string |
| picker | no | antd DatePicker `picker` | `date` \| `week` \| `month` \| `quarter` \| `year` |
| format | no | antd DatePicker `format` (display format) | string |
| size | no | antd DatePicker `size` | `small` \| `middle` \| `large` |
| disabled | no | antd DatePicker `disabled` | boolean |


[Examples](../src/examples/widgets/DatePicker/DatePicker.example.yaml)

---

### Descriptions

Descriptions displays multiple read-only label/value pairs in a definition list (antd Descriptions)

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| bordered | no | whether to render cell borders (antd Descriptions `bordered`) | boolean |
| column | no | the number of label/value pairs per row (antd Descriptions `column`) | integer |
| items | yes | the label/value pairs to display | array |
| items[].format | no | when `value` is an ISO (RFC3339) time, how it is written, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. Absent: the value is shown as it came. | `age` \| `ago` \| `moment` \| `date` |
| items[].href | no | makes the value a link: a page of this app (`/blueprints/ns/name`) opens through the router in the same tab; anything else opens in a new tab | string |
| items[].label | yes | the label of the item | string |
| items[].section | no | (variant:form only) the section this property is grouped under — e.g. a nested object's top-level key; empty/absent = the ungrouped top section | string |
| items[].span | no | how many columns this item spans (antd Descriptions item `span`) | integer |
| items[].value | yes | the value of the item (rendered as the antd Descriptions item children) | string |
| size | no | the size of the description list | `default` \| `middle` \| `small` |
| title | no | the title displayed above the description list | string |
| variant | no | rendering style. 'default' = antd Descriptions definition list; 'form' = read-only mirror of the create Form's property layout — each item a connector-rail field (bold label above a mono value), grouped into sections by the item's `section` (nested objects each become a labelled section) | `default` \| `form` |


[Examples](../src/examples/widgets/Descriptions/Descriptions.example.yaml)

---

### Divider

Divider separates content with a horizontal rule and optional label

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| label | no | optional text shown on the divider | string |
| titlePlacement | no | where the label sits (antd Divider `titlePlacement`; antd 6 renamed from `orientation`) | `left` \| `right` \| `center` |
| dashed | no | render a dashed line | boolean |
| plain | no | render the label in a plain (non-bold) style | boolean |


[Examples](../src/examples/widgets/Divider/Divider.example.yaml)

---

### Dropdown

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| ariaLabel | yes | What the trigger is called for a screen reader and in its tooltip, for example "More actions". Required: the trigger is an icon with no visible text unless `label` is set. | string |
| label | no | Optional visible text beside the trigger's ellipsis icon. Leave unset for the compact icon-only trigger. | string |
| placement | no | Where the menu opens relative to the trigger (antd Dropdown placement). Default `bottomRight`. | `bottomLeft` \| `bottomRight` \| `topLeft` \| `topRight` |
| items | yes | The Button widgets the menu holds, in order. Each is rendered as the real Button widget, so its action, confirmation and permission behaviour are unchanged. | array |
| items[].resourceRefId | yes | Handle of the child to render here, matching an `id` in spec.resourcesRefs. | string |

---

### Filters

Widget kind. Always Filters.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| items | yes | resourceRefIds of form-control widgets (Input/Select/Switch/DatePicker/…) composed as filter fields. Each control's `name` is the dotted data path it filters; the match strategy is inferred from the value type. | array |
| items[].resourceRefId | yes | the identifier of the form-control widget to render as a filter field | string |
| prefix | yes | the prefix used to share filter values with the widgets being filtered | string |


[Examples](../src/examples/widgets/Filters/Filters.example.yaml)

---

### Flex

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| vertical | no | antd Flex vertical (column direction) | boolean |
| justify | no | antd Flex justify (CSS justify-content) | `flex-start` \| `flex-end` \| `center` \| `space-between` \| `space-around` \| `space-evenly` |
| align | no | antd Flex align (CSS align-items) | `flex-start` \| `flex-end` \| `center` \| `stretch` \| `baseline` |
| gap | no | antd Flex gap: a SizeType preset string (small/middle/large) or a numeric pixel value | string | integer |
| wrap | no | antd Flex wrap | boolean |
| role | no | ARIA role of the Flex element (antd Flex renders a div and passes it through). `search` makes a filter bar a search landmark, `region` a named section, `group` and `toolbar` a set of related controls, and `status` a polite live region, for a result count that should be announced when it changes. Absent, the Flex has no role. | `group` \| `region` \| `search` \| `status` \| `toolbar` |
| ariaLabel | no | accessible name of the Flex element (`aria-label`), e.g. "Filter incidents". A `search` or `region` landmark needs one to be told apart from the page's others. | string |
| items | yes | the child widgets rendered inside the Flex | array |
| items[].resourceRefId | yes | Handle of the child to render here, matching an `id` in spec.resourcesRefs. | string |


[Examples](../src/examples/widgets/Flex/Flex.example.yaml)

---

### FlowChart

FlowChart represents a Kubernetes composition as a directed graph. Each node represents a resource, and edges indicate parent-child relationships

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| data | yes | list of kubernetes resources and their relationships to render as nodes in the flow chart | array |
| data[].date | no | optional date value to be shown in the node, formatted as ISO 8601 string | string |
| data[].detail | no | architecture variant: the one line under the name, such as the readiness field and its value, a count, or what the node waits for | string |
| data[].exception | no | architecture variant: the one marker a node carries, and only when something needs attention | object |
| data[].exception.label | yes | the Kubernetes condition that is not true | `NotReady` \| `NotSynced` |
| data[].exception.reason | no | the condition's reason | string |
| data[].exception.message | no | the condition's message | string |
| data[].icon | no | custom icon displayed for the resource node | object |
| data[].icon.name | no | FontAwesome icon class name (e.g. 'fa-check') | string |
| data[].icon.color | no | CSS color value for the icon background | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| data[].icon.message | no | optional tooltip message displayed on hover | string |
| data[].statusIcon | no | custom status icon displayed alongside resource info | object |
| data[].statusIcon.name | no | FontAwesome icon class name representing status | string |
| data[].statusIcon.color | no | CSS color value for the status icon background | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| data[].statusIcon.message | no | optional tooltip message describing the status | string |
| data[].kind | yes | kubernetes resource type (e.g. Deployment, Service) | string |
| data[].name | yes | name of the resource | string |
| data[].names | no | architecture variant: every object this node stands for, by its FULL name. The node's `name` is a DISPLAY string (the composition's own prefix elided, a range written first … last), so before this field the full name existed nowhere the browser could reach and the hover tooltip could only repeat the short form. Presentation belongs to the renderer: this carries the data. Absent on a chart rendered before portal 1.8.74, where `name` is all there is. | array |
| data[].namespace | no | namespace in which the resource is defined | string |
| data[].parentRefs | no | list of parent resources used to define graph relationships | array |
| data[].parentRefs[].date | no | optional date value to be shown in the node, formatted as ISO 8601 string | string |
| data[].parentRefs[].icon | no | custom icon for the parent resource | object |
| data[].parentRefs[].icon.name | no | FontAwesome icon class name | string |
| data[].parentRefs[].icon.color | no | CSS color value for the icon background | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| data[].parentRefs[].icon.message | no | optional tooltip message | string |
| data[].parentRefs[].statusIcon | no | custom status icon for the parent resource | object |
| data[].parentRefs[].statusIcon.name | no | FontAwesome icon class name | string |
| data[].parentRefs[].statusIcon.color | no | CSS color value for the status icon background | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| data[].parentRefs[].statusIcon.message | no | optional tooltip message | string |
| data[].parentRefs[].kind | no | resource type of the parent | string |
| data[].parentRefs[].name | no | name of the parent resource | string |
| data[].parentRefs[].namespace | no | namespace of the parent resource | string |
| data[].parentRefs[].parentRefs | no | nested parent references for recursive relationships | array |
| data[].parentRefs[].resourceVersion | no | internal version string of the parent resource | string |
| data[].parentRefs[].uid | no | unique identifier of the parent resource | string |
| data[].parentRefs[].version | no | api version of the parent resource | string |
| data[].resourceVersion | no | internal version string of the resource | string |
| data[].state | no | architecture variant: where this resource is in the composition's sequence | `done` \| `waiting` \| `withheld` \| `unreadable` \| `unavailable` \| `unknown` |
| data[].uid | yes | unique identifier of the resource | string |
| data[].version | no | api version of the resource | string |
| direction | no | architecture variant: which way the graph runs. LR, when absent: one column per rank, left to right. TB: one row per rank, top to bottom, for a box narrower than the chain is long; the drawing is then as wide as its broadest row. The resource variant ignores it. | `LR` \| `TB` |
| density | no | architecture variant: the card size. regular, when absent: 240x84, with the kind, the name and the detail line. compact: 180x56, with the name on up to two lines and then cut with an ellipsis (the full name and the kind in its tooltip), the detail line, and an exception drawn as the dot alone; closer gaps between cards. The resource variant ignores it. | `regular` \| `compact` |
| variant | no | resource: one node per live object, the original card. architecture: one node per resource a chart declares, drawn in the state the composition is in | `resource` \| `architecture` |


[Examples](../src/examples/widgets/FlowChart/FlowChart.example.yaml)

---

### Form

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| actions | no | the actions of the widget | object |
| actions.rest | no | rest api call actions triggered by the widget | array |
| actions.rest[].id | yes | unique identifier for the action | string |
| actions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| actions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| actions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| actions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| actions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| actions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| actions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| actions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| actions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| actions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| actions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| actions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| actions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| actions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate[].path | no | the identifier of the route to navigate to | string |
| actions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| actions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| actions.navigate[].type | yes | type of navigation action | `navigate` |
| actions.openDrawer | no | actions to open side drawer components | array |
| actions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| actions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| actions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| actions.openDrawer[].title | no | title shown in the drawer header | string |
| actions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| autocomplete | no | Configuration for the Autocomplete form fields. The field options could be configured using enum values coming from the schema or via an API call made using a RESTAction which sould be defined below. The RESTActions shuold contain a `status` field, which is an array of object with the `{ label, value }` format.  | array |
| autocomplete[].extra | no | parameter to be added to the RESTAction call | object |
| autocomplete[].extra.key | yes | the key of the additional parameter | string |
| autocomplete[].name | yes | the name of the autocomplete field | string |
| autocomplete[].resourceRefId | no | the identifier of the RESTAction that should be called to retrieve autocomplete data | string |
| autocomplete[].closed | no | true: only a listed value is accepted (a select); false: the list suggests and typed text is kept. Default false (the previous frontend rendered autocomplete fields as an autocomplete) | boolean |
| autocomplete[].minChars | no | with `extra`: the typed text is sent once it has this many characters. Default 2 | integer |
| autocomplete[].fallback | no | `manual`: a closed field whose options cannot be loaded (the RESTAction fails, or answers an empty list) takes a typed value instead of blocking the form | `manual` |
| buttonConfig | no | custom labels and icons for form buttons | object |
| buttonConfig.primary | no | primary button configuration | object |
| buttonConfig.primary.label | no | text label for primary button | string |
| buttonConfig.primary.icon | no | icon name for primary button | string |
| buttonConfig.primary.block | no | when true, the primary button spans the whole action bar (antd Button `block`), with any other button stacked above it | boolean |
| buttonConfig.primary.size | no | antd Button `size` of the primary button | `small` \| `middle` \| `large` |
| buttonConfig.secondary | no | secondary button configuration | object |
| buttonConfig.secondary.label | no | text label for secondary button | string |
| buttonConfig.secondary.icon | no | icon name for secondary button | string |
| buttonConfig.secondary.navigateTo | no | when set, the secondary button is a Cancel that navigates to this route (SPA) instead of resetting the form | string |
| buttonConfig.secondary.hidden | no | when true, the secondary button (Reset, or the Cancel of `navigateTo`) is not shown | boolean |
| buttonConfig.draft | no | draft button configuration — only rendered when widgetData.draftActionId is also set; clicking it persists the current (un-validated) field values via that action | object |
| buttonConfig.draft.label | no | text label for draft button | string |
| buttonConfig.draft.icon | no | icon name for draft button | string |
| buttonConfig.review | no | Configure-step button label when reviewBeforeSubmit is set (the button that opens the in-place Review; default 'Review →') | object |
| buttonConfig.review.label | no | text label for the Review button | string |
| buttonConfig.reviewBack | no | Review-step back button label when reviewBeforeSubmit is set (returns to editing; default '← Back to edit') | object |
| buttonConfig.reviewBack.label | no | text label for the back-to-edit button | string |
| checkboxes | no | boolean fields drawn as a Checkbox whose text is the field's label (its schema `title`, else its key), where a boolean is otherwise a Switch. The label is plain text; one phrase of it can be a link. A REQUIRED checkbox must be ticked to submit | array |
| checkboxes[].name | yes | the dotted path of a boolean field; an entry naming any other field is ignored | string |
| checkboxes[].link | no | one link in the label: the first occurrence of `text` in the label becomes a link to `href`, opened in a new tab (when `text` is not in the label, the link follows it) | object |
| checkboxes[].link.text | yes | the phrase of the label that is the link | string |
| checkboxes[].link.href | yes | an http(s) or mailto URL, or a path on the portal (`/…`), with no whitespace or control characters; any other is not drawn as a link | string |
| checkboxes[].requiredMessage | no | the message under a required checkbox left unticked | string |
| checkboxes[].hideOptionalMark | no | `true`: no "(optional)" after this checkbox when it is optional and the form has `requiredMark: optional` — for a box whose sentence already says it is a choice. A required checkbox is unaffected | boolean |
| dependencies | no | Configuration for the form fields who are dependent from other form fields. The field options are set via an API call made using a RESTAction which sould be defined below. The RESTActions shuold contain a `status` field, which is an array of object with the `{ label, value }` format.  | array |
| dependencies[].dependsOn | yes | the field on which this field depends on | object |
| dependencies[].dependsOn.name | yes | the name of the field on which this field depends on | string |
| dependencies[].extra | yes | parameter to be added to the RESTAction call | object |
| dependencies[].extra.key | yes | the key of the additional parameter | string |
| dependencies[].name | yes | the name of the autocomplete field | string |
| dependencies[].resourceRefId | yes | the identifier of the RESTAction that should be called to retrieve dependency data | string |
| dependencies[].closed | no | true: only a listed value is accepted (a select); false: the list suggests and typed text is kept. Default true (the previous frontend rendered dependent fields as a select) | boolean |
| dependencies[].fallback | no | `manual`: a closed field whose options cannot be loaded (the RESTAction fails, or answers an empty list) takes a typed value instead of blocking the form | `manual` |
| disabled | no | antd Form disabled (disables all fields) | boolean |
| displayingDependencies | no | Configuration for the form fields whose displaying is dependent from other form fields. | array |
| displayingDependencies[].name | yes | the name of the field | string |
| displayingDependencies[].dependsOn | yes | the field on which this field depends on | object |
| displayingDependencies[].dependsOn.name | yes | the name of the field on which this field depends on | string |
| displayingDependencies[].dependsOn.conditionType | yes | `notEmpty` (default) indicates that the current field is displayed if the dependency field has a non-empty value. `value` indicates that the current field is displayed only when the dependency field matches a specific value. | `notEmpty` \| `value` |
| displayingDependencies[].dependsOn.value | no | Expected value used when `type = value`. | object |
| displayingDependencies[].dependsOn.value.type | yes | Expected dependency value type. | `string` \| `integer` \| `boolean` \| `array` \| `option` \| `null` |
| displayingDependencies[].dependsOn.value.stringValue | no | Value if type = string | string |
| displayingDependencies[].dependsOn.value.integerValue | no | Value if type = integer | integer |
| displayingDependencies[].dependsOn.value.booleanValue | no | Value if type = boolean | boolean |
| displayingDependencies[].dependsOn.value.arrayValue | no | Value if type = array | array |
| displayingDependencies[].dependsOn.value.optionValue | no | Value if type = option: includes a single value or a { label, value } object | object |
| displayingDependencies[].dependsOn.value.optionValue.label | no | Label of the option | string |
| displayingDependencies[].dependsOn.value.optionValue.value | yes | Value of the option. A number or a boolean is compared with type integer or boolean. | string |
| draftActionId | no | optional id of an action fired by a 'Save draft' button that captures the CURRENT field values WITHOUT running form validation (so an incomplete form can be persisted). Pair with buttonConfig.draft to show the button. | string |
| fieldChecks | no | fields checked against a same-origin endpoint as they are typed: after typing pauses and on blur, the field's value (with `bodyExtras`) is POSTed as JSON and the answer becomes the field's validation status and message. A newer value aborts the check in flight; an answer for an old value is never applied. An empty value, or one failing the field's own rules, is not checked. While a check runs the field shows antd's validating spinner, and a submit waits for that answer | array |
| fieldChecks[].name | yes | the dotted path of the field to check (a text-like field: not a boolean, object or list) | string |
| fieldChecks[].path | yes | the same-origin path to POST JSON to. Sent through the page transport's allow-listed post: the path must be under one of the installation's PUBLIC_POST_PATHS, and no credential is ever sent (public page or signed in). Any other path is refused unsent | string |
| fieldChecks[].bodyKey | no | the body key the value is sent under; the last segment of `name` when absent | string |
| fieldChecks[].bodyExtras | no | body key → the name of one of the page's fragment extras (the keys its root declares in `krateo.io/fragment-keys`), e.g. `{ submission: s, token: t }`: those values are sent in the request BODY, never in a URL, and never enter the form. A key the page was not opened with is left out | object |
| fieldChecks[].debounceMs | no | how long typing must pause before the check is sent, in milliseconds; 500 when absent. Blur sends it at once | integer |
| fieldChecks[].timeoutMs | no | the client timeout in milliseconds; 10000 when absent. A timeout is `otherwise`. Leave room for an endpoint that holds its answer | integer |
| fieldChecks[].answers | no | what each answer means for the field, tried in order (first match wins) | array |
| fieldChecks[].answers[].when | no | which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise` | object |
| fieldChecks[].answers[].when.status | no | HTTP statuses, e.g. [429] | array |
| fieldChecks[].answers[].when.bodyField | no | a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals` | string |
| fieldChecks[].answers[].when.equals | no | the values `bodyField` may hold for this entry to match | array |
| fieldChecks[].answers[].validateStatus | no | the field's validation status for this answer (`warning` when absent). `error` blocks submitting, `warning` does not; `success` shows `message` as the field's help | `success` \| `warning` \| `error` |
| fieldChecks[].answers[].message | no | the message under the field; may name `{value}` (the checked value), `{body.<dotted>}` and `{retryAfter}` | string |
| fieldChecks[].answers[].retryAfterMessage | no | the message instead of `message` when the answer carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown | string |
| fieldChecks[].answers[].ruleFrom | no | a dotted path into the response body naming a rule, e.g. `rule`; its `ruleMessages` entry replaces `message` | string |
| fieldChecks[].answers[].ruleMessages | no | rule → message, for `ruleFrom` | object |
| fieldChecks[].answers[].result | no | an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup | object |
| fieldChecks[].answers[].result.status | yes | antd Result `status` | `success` \| `info` \| `warning` \| `error` |
| fieldChecks[].answers[].result.title | yes | antd Result `title` | string |
| fieldChecks[].answers[].result.subtitle | no | antd Result `subTitle` | string |
| fieldChecks[].answers[].result.icon | no | an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon | string |
| fieldChecks[].answers[].result.extra | no | the Result's actions, in order | array |
| fieldChecks[].answers[].result.extra[].kind | yes | `button`: an antd primary Button; `link`: a plain link, after `text` | `button` \| `link` |
| fieldChecks[].answers[].result.extra[].label | yes | the button's or the link's text | string |
| fieldChecks[].answers[].result.extra[].href | yes | an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action | string |
| fieldChecks[].answers[].result.extra[].text | no | plain text before a `link`, e.g. `Already have an account?` | string |
| fieldChecks[].otherwise | no | the answer for anything no entry matched, a network error and the timeout; when absent, a warning "We couldn't check this right now." | object |
| fieldChecks[].otherwise.when | no | which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise` | object |
| fieldChecks[].otherwise.when.status | no | HTTP statuses, e.g. [429] | array |
| fieldChecks[].otherwise.when.bodyField | no | a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals` | string |
| fieldChecks[].otherwise.when.equals | no | the values `bodyField` may hold for this entry to match | array |
| fieldChecks[].otherwise.validateStatus | no | the field's validation status for this answer (`warning` when absent). `error` blocks submitting, `warning` does not; `success` shows `message` as the field's help | `success` \| `warning` \| `error` |
| fieldChecks[].otherwise.message | no | the message under the field; may name `{value}` (the checked value), `{body.<dotted>}` and `{retryAfter}` | string |
| fieldChecks[].otherwise.retryAfterMessage | no | the message instead of `message` when the answer carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown | string |
| fieldChecks[].otherwise.ruleFrom | no | a dotted path into the response body naming a rule, e.g. `rule`; its `ruleMessages` entry replaces `message` | string |
| fieldChecks[].otherwise.ruleMessages | no | rule → message, for `ruleFrom` | object |
| fieldChecks[].otherwise.result | no | an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup | object |
| fieldChecks[].otherwise.result.status | yes | antd Result `status` | `success` \| `info` \| `warning` \| `error` |
| fieldChecks[].otherwise.result.title | yes | antd Result `title` | string |
| fieldChecks[].otherwise.result.subtitle | no | antd Result `subTitle` | string |
| fieldChecks[].otherwise.result.icon | no | an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon | string |
| fieldChecks[].otherwise.result.extra | no | the Result's actions, in order | array |
| fieldChecks[].otherwise.result.extra[].kind | yes | `button`: an antd primary Button; `link`: a plain link, after `text` | `button` \| `link` |
| fieldChecks[].otherwise.result.extra[].label | yes | the button's or the link's text | string |
| fieldChecks[].otherwise.result.extra[].href | yes | an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action | string |
| fieldChecks[].otherwise.result.extra[].text | no | plain text before a `link`, e.g. `Already have an account?` | string |
| fieldHelp | no | help text shown UNDER a field's input (antd Form.Item `extra`), where it stays in view while a validation message shows above it. Plain text | array |
| fieldHelp[].name | yes | the dotted path of a field (not an object or a list) | string |
| fieldHelp[].text | yes | the help text | string |
| fieldInputs | no | a field's input: its placeholder, its HTML input type, its autocomplete token, and whether the browser spell-checks and capitalises it. `placeholder` applies to a text Input, a TextArea and a Select (in place of "Select…"); `type` to a text Input; `autoComplete`, `spellCheck` and `autoCapitalize` to a text Input and a TextArea. An entry naming a group, a list, a boolean, a number or a secret field is ignored | array |
| fieldInputs[].autoCapitalize | no | the input's `autocapitalize` attribute: how a phone's keyboard capitalises what is typed. `none` for a username or a code | `none` \| `sentences` \| `words` \| `characters` |
| fieldInputs[].autoComplete | no | the input's `autocomplete` attribute: one autofill field name of the HTML standard (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill), or `on` / `off`. Credential and payment tokens are not offered: a secret field has its own | `off` \| `on` \| `name` \| `honorific-prefix` \| `given-name` \| `additional-name` \| `family-name` \| `honorific-suffix` \| `nickname` \| `username` \| `organization-title` \| `organization` \| `street-address` \| `address-line1` \| `address-line2` \| `address-line3` \| `address-level4` \| `address-level3` \| `address-level2` \| `address-level1` \| `country` \| `country-name` \| `postal-code` \| `language` \| `bday` \| `bday-day` \| `bday-month` \| `bday-year` \| `sex` \| `url` \| `photo` \| `email` \| `impp` \| `tel` \| `tel-country-code` \| `tel-national` \| `tel-area-code` \| `tel-local` \| `tel-extension` |
| fieldInputs[].name | yes | the dotted path of a field | string |
| fieldInputs[].placeholder | no | the text the empty control shows | string |
| fieldInputs[].spellCheck | no | the input's `spellcheck` attribute. `false` for a username, a code or a name the browser would mark as misspelt | boolean |
| fieldInputs[].type | no | the text Input's HTML type: the keyboard a phone shows and what the browser offers to fill. The form's own rules still validate the value: with a `type`, the form turns off the browser's constraint validation (`novalidate`), so its errors show under the field like every other | `text` \| `email` \| `tel` \| `url` |
| hasFeedback | no | which fields of a schema form show antd's validation feedback icons. Absent: required fields. `rules`: every field with a validation rule, required or optional (an optional field shows the success icon only once it holds a value). `none`: no field, a `fieldChecks` field included | `rules` \| `none` |
| initialValues | no | optional object with initial values for form fields. Keys should match form field names (supports nested objects). These values override schema defaults. | object |
| items | no | resourceRefIds of form-control widgets (Input, Select, Switch, …) to compose inside the Form. Composable mode — an alternative to the schema/stringSchema generator. | array |
| items[].resourceRefId | yes | the identifier of the form-control widget to render | string |
| layout | no | antd Form layout | `horizontal` \| `vertical` \| `inline` |
| notice | no | a message shown above the fields of a schema form (e.g. the blueprint formdef's note that the form was built from the CRD) | string |
| noticeVariant | no | how `notice` is drawn: `alert` (absent), an info Alert; `text`, a line of secondary text. Either goes with the form when a Result replaces it | `alert` \| `text` |
| notices | no | notices shown above the fields of a schema form, after `notice`: each an Alert with a title, optional paragraphs, and optional details text in a collapsed Details section (e.g. the blueprint form's note that its inputs were inferred from the chart's default values, with the provider's condition message as the details) | array |
| notices[].description | no | paragraphs under the title, in order | array |
| notices[].details | no | text shown verbatim, in monospace, when the reader opens Details (e.g. a controller's condition message) | string |
| notices[].title | yes | the notice's one-line title | string |
| notices[].type | no | the notice's tone: `info` (absent), or `warning` for something that will stop the person (e.g. a value the blueprint's served version refuses) | `info` \| `warning` |
| objectFields | no | configuration for object fields in the form | array |
| objectFields[].path | yes | the path of the object field | string |
| objectFields[].displayField | yes | the field to display in the objects list | string |
| propertiesToHide | no | top-level schema property names to omit from the schema-driven form | array |
| requiredMark | no | antd Form requiredMark. `optional`: required fields carry no mark and every other field reads "(optional)"; in a schema form the optional fields then render in place, in schema order, instead of in the "Advanced" collapse. Absent: required fields are marked with an asterisk. `hidden`: no field carries a mark, required or not (antd `requiredMark={false}`) | `optional` \| `hidden` |
| reviewBeforeSubmit | no | when true (inline render only), the primary button validates and reveals an in-place read-only Review of the entered values before the real submit — the form stays mounted so 'Back to edit' preserves every value. Pair with buttonConfig.review / buttonConfig.reviewBack for custom labels. | boolean |
| schema | no | JSON schema (e.g. a blueprint CRD's openAPIV3Schema spec) rendered as form fields — the schema-driven alternative to `items`. Usually populated server-side via a widgetDataTemplate jq expression that extracts the spec schema. Note: a schema sourced from a CRD's openAPIV3Schema has its `properties` map serialized alphabetically (order lost); use `stringSchema` to preserve the source values.schema.json authoring order. | object |
| size | no | antd Form size | `small` \| `middle` \| `large` |
| stringSchema | no | Same JSON schema as `schema`, but as a raw JSON STRING. Preferred over `schema` when present: the client JSON.parses it, preserving key insertion order, so fields render in the source values.schema.json order rather than the alphabetized order a CRD-sourced object schema yields. Typically populated server-side from the blueprint's per-version jsonschema ConfigMap (which keeps authoring order). Falls back to `schema` when absent or not valid JSON. | string |
| submitActionId | no | the id of the action to be called when the form is submitted. A Form submits EITHER through `actions` + `submitActionId` OR through `submitPost`; with neither or both it renders an error | string |
| submitActionSelector | no | optional field-conditional submit routing: when present, the submit action is chosen at submit time from the value of the named field. Routes one form to different create targets (e.g. a 'target cluster' select where 'local' posts the blueprint instance and a remote spoke posts a RemoteInstall). Falls back to `default` (or `submitActionId`) when the field value has no mapping. | object |
| submitActionSelector.field | yes | form field whose current value selects the submit action | string |
| submitActionSelector.map | yes | map of field-value → action id | object |
| submitActionSelector.default | no | action id used when the field value is not present in `map` | string |
| submitDisabledWhenPristine | no | when true, the primary (submit) button stays disabled until at least one field differs from its initial value (initialValues overlaid on schema defaults). Use for update forms where submitting an unchanged value is a no-op — e.g. a version picker pre-set to the currently-installed version. | boolean |
| submitPost | no | submit by POSTing the form's values as JSON to an allow-listed same-origin path, instead of a snowplow write through `actions`/`submitActionId` (a Form has exactly one of the two). While it is in flight the form is disabled and the primary button loading. Each response is mapped to a `result` (replaces the form), `fieldErrors` or an inline `alert`; when an entry sets several, `result` wins, then `fieldErrors` | object |
| submitPost.path | yes | the same-origin path to POST JSON to. Sent through the page transport's allow-listed post: the path must be under one of the installation's PUBLIC_POST_PATHS, and no credential is ever sent (public page or signed in). Any other path is refused unsent | string |
| submitPost.bodyExtras | no | body key → the name of one of the page's fragment extras (the keys its root declares in `krateo.io/fragment-keys`), e.g. `{ submission: s, token: t }`: those values are sent in the request BODY, never in a URL, and never enter the form. A key the page was not opened with is left out | object |
| submitPost.timeoutMs | no | the client timeout in milliseconds; 10000 when absent. A timeout is `otherwise`. Leave room for an endpoint that holds its answer | integer |
| submitPost.responses | no | what each response means, tried in order (first match wins) | array |
| submitPost.responses[].when | no | which answers this entry is for. Every condition given must hold; one left out matches anything. Entries are tried in order and the first match wins. An entry with no `when` matches every answer (entries after it are never reached). A request that got no answer (a network error, the client timeout) matches no entry: it is `otherwise` | object |
| submitPost.responses[].when.status | no | HTTP statuses, e.g. [429] | array |
| submitPost.responses[].when.bodyField | no | a dotted path into the JSON response body, e.g. `status`; the entry matches only when that field is a string listed in `equals` | string |
| submitPost.responses[].when.equals | no | the values `bodyField` may hold for this entry to match | array |
| submitPost.responses[].result | no | an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup | object |
| submitPost.responses[].result.status | yes | antd Result `status` | `success` \| `info` \| `warning` \| `error` |
| submitPost.responses[].result.title | yes | antd Result `title` | string |
| submitPost.responses[].result.subtitle | no | antd Result `subTitle` | string |
| submitPost.responses[].result.icon | no | an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon | string |
| submitPost.responses[].result.extra | no | the Result's actions, in order | array |
| submitPost.responses[].result.extra[].kind | yes | `button`: an antd primary Button; `link`: a plain link, after `text` | `button` \| `link` |
| submitPost.responses[].result.extra[].label | yes | the button's or the link's text | string |
| submitPost.responses[].result.extra[].href | yes | an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action | string |
| submitPost.responses[].result.extra[].text | no | plain text before a `link`, e.g. `Already have an account?` | string |
| submitPost.responses[].fieldErrors | no | errors on the fields the response names. A field's message is `ruleMessages[<the body's ruleFrom>]`, else `fieldMessages[<field>]`, else `message`, else "Check this field.". Names the form does not have are ignored; if none is left, `message` shows as an error Alert | object |
| submitPost.responses[].fieldErrors.names | no | dotted field paths, always named | array |
| submitPost.responses[].fieldErrors.namesFrom | no | a dotted path into the response body holding an array of field names, e.g. `fields` | string |
| submitPost.responses[].fieldErrors.ruleFrom | no | a dotted path into the response body naming a rule, e.g. `rule` | string |
| submitPost.responses[].fieldErrors.ruleMessages | no | rule → message | object |
| submitPost.responses[].fieldErrors.fieldMessages | no | field (dotted path) → message | object |
| submitPost.responses[].fieldErrors.message | no | the message for a field with no other | string |
| submitPost.responses[].alert | no | an antd Alert directly above the form's buttons (not a toast); cleared when the next submit starts. Strings may name `{body.<dotted>}` and `{retryAfter}` | object |
| submitPost.responses[].alert.type | yes | antd Alert `type` | `warning` \| `error` \| `info` |
| submitPost.responses[].alert.title | yes | antd Alert `title` | string |
| submitPost.responses[].alert.description | no | antd Alert `description` | string |
| submitPost.responses[].alert.retryAfterDescription | no | the description instead of `description` when the response carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown | string |
| submitPost.otherwise | no | the outcome for anything no entry matched, a network error and the timeout; when absent, an error Alert "We couldn't send this form." | object |
| submitPost.otherwise.result | no | an antd Result that REPLACES the form (and its buttons). Its strings may name `{body.<dotted>}` (a value from the response, e.g. `{body.username}`), `{value}` (a checked field's value) and `{retryAfter}`; they are plain text, never markup | object |
| submitPost.otherwise.result.status | yes | antd Result `status` | `success` \| `info` \| `warning` \| `error` |
| submitPost.otherwise.result.title | yes | antd Result `title` | string |
| submitPost.otherwise.result.subtitle | no | antd Result `subTitle` | string |
| submitPost.otherwise.result.icon | no | an icon name, as buttonConfig takes them (e.g. `fa-envelope`), in place of the status icon | string |
| submitPost.otherwise.result.extra | no | the Result's actions, in order | array |
| submitPost.otherwise.result.extra[].kind | yes | `button`: an antd primary Button; `link`: a plain link, after `text` | `button` \| `link` |
| submitPost.otherwise.result.extra[].label | yes | the button's or the link's text | string |
| submitPost.otherwise.result.extra[].href | yes | an http(s) or mailto URL, or a path on the portal (`/…`, opened inside the app), with no whitespace or control characters; any other drops this action | string |
| submitPost.otherwise.result.extra[].text | no | plain text before a `link`, e.g. `Already have an account?` | string |
| submitPost.otherwise.fieldErrors | no | errors on the fields the response names. A field's message is `ruleMessages[<the body's ruleFrom>]`, else `fieldMessages[<field>]`, else `message`, else "Check this field.". Names the form does not have are ignored; if none is left, `message` shows as an error Alert | object |
| submitPost.otherwise.fieldErrors.names | no | dotted field paths, always named | array |
| submitPost.otherwise.fieldErrors.namesFrom | no | a dotted path into the response body holding an array of field names, e.g. `fields` | string |
| submitPost.otherwise.fieldErrors.ruleFrom | no | a dotted path into the response body naming a rule, e.g. `rule` | string |
| submitPost.otherwise.fieldErrors.ruleMessages | no | rule → message | object |
| submitPost.otherwise.fieldErrors.fieldMessages | no | field (dotted path) → message | object |
| submitPost.otherwise.fieldErrors.message | no | the message for a field with no other | string |
| submitPost.otherwise.alert | no | an antd Alert directly above the form's buttons (not a toast); cleared when the next submit starts. Strings may name `{body.<dotted>}` and `{retryAfter}` | object |
| submitPost.otherwise.alert.type | yes | antd Alert `type` | `warning` \| `error` \| `info` |
| submitPost.otherwise.alert.title | yes | antd Alert `title` | string |
| submitPost.otherwise.alert.description | no | antd Alert `description` | string |
| submitPost.otherwise.alert.retryAfterDescription | no | the description instead of `description` when the response carries a Retry-After of a positive number of seconds; `{retryAfter}` is that wait ("30 seconds", or whole minutes above 60: "2 minutes"), stated once, with no countdown | string |
| suggestions | no | a static, open catalogue for a field: the options are offered, and any typed value is kept | array |
| suggestions[].name | yes | the name of the field | string |
| suggestions[].options | yes | the catalogue, in the order it is shown | array |
| suggestions[].options[].value | yes | the value written into the field | string |
| suggestions[].options[].label | no | shown instead of the value | string |
| suggestions[].options[].description | no | a muted second line | string |
| suggestions[].options[].group | no | the heading the option is grouped under | string |
| textareas | no | string fields drawn as a multi-line TextArea instead of a one-line Input. An entry naming a field that is not a string, or that has an `enum` or a `oneOf`, is ignored | array |
| textareas[].name | yes | the dotted path of a string field | string |
| textareas[].rows | no | the TextArea's height in rows; 3 when absent | integer |
| title | no | a heading above the form's fields. It goes with the form when a `submitPost` or `fieldChecks` result replaces it, so a page's heading can live in the Form | string |
| validationMessages | no | the messages a field's validation shows, in place of the generated ones. A checkbox has its own, in `checkboxes` | array |
| validationMessages[].name | yes | the dotted path of a field | string |
| validationMessages[].requiredMessage | no | shown when the field is required and left empty, in place of "<Label> is required" | string |


[Examples](../src/examples/widgets/Form/Form.example.yaml)


> For additional information about the `autocomplete` and `dependencies` properties configuration, please visit [this page](./autocomplete-and-dependencies.md).

      

> For additional information about the `initialValues` property configuration, please visit [this page](./form-values.md).

---

### Image

Image renders the antd Image component (a single image with optional preview/zoom and a fallback)

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| src | yes | the image source URL (antd Image `src`) | string |
| alt | no | alternative text (antd Image `alt`) | string |
| width | no | image width in px (number) or any CSS length (string) — antd Image `width` | integer | string |
| height | no | image height in px (number) or any CSS length (string) — antd Image `height` | integer | string |
| preview | no | whether clicking the image opens the zoom/preview overlay (antd Image `preview`); set false for decorative images such as logos | boolean |
| fallback | no | image src to show if `src` fails to load (antd Image `fallback`) | string |
| placeholder | no | show the default blurred placeholder while loading (antd Image `placeholder`) | boolean |
| rootClassName | no | class name on the image wrapper (antd Image `rootClassName`) | string |
| loading | no | native lazy/eager loading hint (antd Image `loading`) | `eager` \| `lazy` |
| crossOrigin | no | CORS setting for the request (native img `crossOrigin`) | `anonymous` \| `use-credentials` \| `` |
| decoding | no | image decoding hint (native img `decoding`) | `async` \| `auto` \| `sync` |
| referrerPolicy | no | referrer policy for the request (native img `referrerPolicy`) | `` \| `no-referrer` \| `no-referrer-when-downgrade` \| `origin` \| `origin-when-cross-origin` \| `same-origin` \| `strict-origin` \| `strict-origin-when-cross-origin` \| `unsafe-url` |
| sizes | no | responsive sizes hint (native img `sizes`) | string |
| srcSet | no | responsive source set (native img `srcSet`) | string |
| useMap | no | name of an image map (native img `useMap`) | string |
| draggable | no | whether the image is draggable (native img `draggable`) | boolean |
| title | no | native title tooltip (native img `title`) | string |

---

### Input

Input is a form-control widget wrapping Ant Design Input. It renders inside a Form widget's context and binds its value by `name`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` (collected on submit) | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule to the field | boolean |
| defaultValue | no | antd Form.Item `initialValue` | string |
| placeholder | no | antd Input `placeholder` | string |
| type | no | antd Input `type` | `text` \| `password` \| `email` \| `number` \| `tel` \| `url` |
| size | no | antd Input `size` | `small` \| `middle` \| `large` |
| disabled | no | antd Input `disabled` | boolean |
| allowClear | no | antd Input `allowClear` | boolean |
| maxLength | no | antd Input `maxLength` | integer |
| queryParam | no | when set, the Input is a STANDALONE URL-query-bound SEARCH box (antd Input.Search), NOT a Form control: submitting (Enter / search button) writes ?<queryParam>= into the URL → extras, so a data source can filter server-side in its RESTAction jq (e.g. `.q`). Clearing removes the param. | string |


[Examples](../src/examples/widgets/Input/Input.example.yaml)

---

### InputNumber

InputNumber is a form-control widget wrapping Ant Design InputNumber. It renders inside a Form widget's context and binds its value by `name`. (min/max/step are integers — controller-gen rejects floats.)

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule | boolean |
| defaultValue | no | antd Form.Item `initialValue` | integer |
| placeholder | no | antd InputNumber `placeholder` | string |
| min | no | antd InputNumber `min` | integer |
| max | no | antd InputNumber `max` | integer |
| step | no | antd InputNumber `step` | integer |
| size | no | antd InputNumber `size` | `small` \| `middle` \| `large` |
| disabled | no | antd InputNumber `disabled` | boolean |


[Examples](../src/examples/widgets/InputNumber/InputNumber.example.yaml)

---

### Layout

Layout wraps the Ant Design Layout component: optional Header, Sider, Content and Footer regions, each rendering a child widget. The Sider exposes antd's collapse/responsive props.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| hasSider | no | antd Layout `hasSider` — declares a Sider child so the flex direction is correct on first paint | boolean |
| header | no | resourceRefId of the widget rendered in antd Layout.Header | string |
| content | no | resourceRefId of the widget rendered in antd Layout.Content | string |
| footer | no | resourceRefId of the widget rendered in antd Layout.Footer | string |
| effects | no | resourceRefIds of side-effect widgets (e.g. Theme) rendered invisibly: they set global state (CSS custom properties, etc.) and produce no UI. Use for app-wide concerns mounted once on the shell. | array |
| sider | no | antd Layout.Sider region | object |
| sider.resourceRefId | no | resourceRefId of the widget rendered inside the Sider | string |
| sider.header | no | resourceRefId of the widget rendered at the top of the Sider, above its content (a brand logo, for example). It shows while the Sider is expanded, and while it is collapsed too unless `collapsedHeader` is set | string |
| sider.collapsedHeader | no | resourceRefId of the widget rendered at the top of the Sider in place of `header` while the Sider is collapsed to its icon rail (a compact logo, for example). Unset, `header` shows in both states | string |
| sider.width | no | antd Sider `width` in px | integer |
| sider.collapsible | no | antd Sider `collapsible` (renders a collapse trigger) | boolean |
| sider.collapsedWidth | no | antd Sider `collapsedWidth` in px | integer |
| sider.breakpoint | no | antd Sider responsive `breakpoint`; auto-collapses below it, to `collapsedWidth`. When unset the Sider collapses below `lg`. Below `md` a Layout with a header shows the Sider's content in a drawer opened from a header button instead | `xs` \| `sm` \| `md` \| `lg` \| `xl` \| `xxl` |
| sider.theme | no | antd Sider `theme` | `light` \| `dark` |
| sider.defaultCollapsed | no | antd Sider `defaultCollapsed` | boolean |
| sider.reverseArrow | no | antd Sider `reverseArrow` | boolean |


[Examples](../src/examples/widgets/Layout/Layout.example.yaml)

---

### LineChart

LineChart wraps the @ant-design/charts Line component (AntV G2). It mirrors that library's data + field-mapping API: pass a flat `data` array and map fields to positions/color.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| data | yes | chart data records (G2 `data`) | array |
| xField | yes | field mapped to the x position (G2 `xField`) | string |
| yField | yes | field mapped to the y position (G2 `yField`) | string |
| colorField | no | field mapped to color / series (G2 `colorField`) | string |
| shapeField | no | line shape, e.g. 'smooth' or 'line' (G2 `shapeField`) | string |
| stack | no | stack the series (G2 `stack`) | boolean |
| area | no | render a gradient area fill under the line (G2 `area`); defaults to false | boolean |
| legend | no | show the legend; false hides it (G2 `legend`) | boolean |
| title | no | chart title (G2 `title`) | string |
| height | no | fixed height in px (G2 `height`); omit to autofit | integer |
| annotations | no | G2 annotation marks passed through (e.g. a peak `point` marker + a dashed `lineX` "now" line); usually computed server-side via a widgetDataTemplate | array |
| point | no | render a default circle marker at each data point (G2 composed `point` mark). Improves legibility of sparse series. | boolean |
| scale | no | G2 per-channel scale config (G2 `scale`), e.g. {"y":{"zero":true,"nice":true,"domainMin":0,"domainMax":3,"tickCount":4}}. domainMax is a floor — data larger than it still wins, so dense data is never clipped. | object |
| axis | no | G2 per-channel axis config (G2 `axis`), e.g. {"x":{"tickCount":6},"y":{"tickCount":4}} | object |
| xTimeUnit | no | When set, `xField` values are UNIX epoch SECONDS and the x axis is TIME: points are placed by their moment, and ticks are labelled in the VIEWER's time zone, as all text is: 'hour' -> 'HH:MM', with the day ('24 Nov'; '31 Dec 2025' in another year) where it changes; 'day' -> the day. The tooltip gives the point's full date with the zone ('Tue 24 November 2026, 08:00:00 (UTC+1)'). Use this instead of server-side strftime, which is UTC and repeats across days. Annotations sharing `xField` are placed identically, so peak/now marks stay aligned. | `hour` \| `day` |
| slotField | no | The row field that says a slot is not a whole measurement: `partial` for the slot still filling (the one that holds now), `missing` for a slot where nothing was recorded (send its value as null, never 0). Any other value, or none, is a whole slot. A slot with no data breaks the line over a hatched band labelled 'No data', whose hover reads 'No data · 25 Nov, 09:50 to 10:20'; the slot still filling ends the line with a dashed segment and a hollow point labelled 'so far', and its hover value ends 'so far'. A legend entry 'so far' or 'no data' is added under the chart only when such a slot is drawn. With several series a band is drawn only where every series has no data; one series without a value breaks only its own line. Meant for a time axis (`xTimeUnit`), where the band's hover names its times in the viewer's zone. | string |
| colorMap | no | map each colorField category to a Krateo palette colour name (e.g. {"Created":"cyan"}); sets the G2 color scale domain/range so the line + points render in the brand colour, not G2's default blue palette | object |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/LineChart/LineChart.example.yaml)

---

### Listy

Listy renders an array of items, following the Ant Design List API (grid, itemLayout, size, bordered, split, header, footer). Each dataSource element is rendered via itemTemplate, or as a child widget when it carries a resourceRefId. Named 'Listy' (antd's successor to the deprecated List) because k8s reserves the 'List' kind. Supersedes DataGrid.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| grid | no | antd List grid layout (ListGridType); presence enables grid mode | object |
| grid.gutter | no | Spacing between grid columns, in pixels. Mirrors antd List `grid.gutter`. | integer |
| grid.column | no | Number of columns at the default breakpoint. Mirrors antd List `grid.column`. | integer |
| grid.xs | no | Number of columns at the extra-small breakpoint. Mirrors antd List `grid.xs`. | integer |
| grid.sm | no | Number of columns at the small breakpoint. Mirrors antd List `grid.sm`. | integer |
| grid.md | no | Number of columns at the medium breakpoint. Mirrors antd List `grid.md`. | integer |
| grid.lg | no | Number of columns at the large breakpoint. Mirrors antd List `grid.lg`. | integer |
| grid.xl | no | Number of columns at the extra-large breakpoint. Mirrors antd List `grid.xl`. | integer |
| grid.xxl | no | Number of columns at the extra-extra-large breakpoint. Mirrors antd List `grid.xxl`. | integer |
| itemLayout | no | antd List itemLayout | `horizontal` \| `vertical` |
| size | no | antd List size | `default` \| `large` \| `small` |
| bordered | no | antd List bordered | boolean |
| split | no | antd List split | boolean |
| loading | no | antd List loading | boolean |
| hideWhenEmpty | no | When there are no items, render nothing (null) instead of the antd Empty 'No data' placeholder. Enables a server-driven conditional section: the RA emits items only when a condition holds (e.g. compositions count == 0), so the section appears/disappears with the data without any client-side logic. | boolean |
| header | no | antd List header (ReactNode in antd; string here) | string |
| footer | no | antd List footer (ReactNode in antd; string here) | string |
| footerNavigateTo | no | in-app route the footer opens (e.g. /incidents); when set the footer renders as a link. Not an antd prop: antd's footer is a ReactNode, and a CR can only say where it goes. | string |
| pagination | no | antd List pagination (serializable subset); presence enables client-side paging of the delivered dataSource (e.g. the ~400-card Marketplace grid). Server-side facet/search filters (?extras) shrink the array BEFORE it reaches the widget, so paging composes with them: antd clamps the current page into the filtered range, and a single-page result hides the pager entirely (exception-only chrome). Absent = antd default (no pagination). | object |
| pagination.pageSize | yes | antd pagination.pageSize — items per page | integer |
| pagination.position | no | antd List pagination.position (default bottom) | `top` \| `bottom` \| `both` |
| dataSource | no | antd List dataSource. Each element is a data object (rendered via itemTemplate) or { resourceRefId } (rendered as a child widget). | array |
| itemTemplate | no | serializable substitute for antd renderItem: maps a data element's fields to row slots ({dot.path}; {a|b} first-non-empty) | object |
| itemTemplate.primaryText | no | {dot.path} to the row's main label. | string |
| itemTemplate.secondaryText | no | {dot.path} to the value shown opposite the primary text. | string |
| itemTemplate.subPrimaryText | no | {dot.path} to the line beneath the primary text. | string |
| itemTemplate.subSecondaryText | no | {dot.path} to the line beneath the secondary text. | string |
| itemTemplate.description | no | longer body line (2-line clamp); only rendered by the card rowVariant (e.g. a catalog tile description) | string |
| itemTemplate.cardCta | no | card-footer call-to-action cue (e.g. "Configure") shown footer-left when a card rowVariant is clickable (navigateTo); rendered as mono amber text + a sliding arrow (a navigation hint, not a button) | string |
| itemTemplate.icon | no | {dot.path} to an icon name, or a literal name, shown at the row leading edge. | string |
| itemTemplate.iconVariant | no | leading-indicator style: avatar (solid disc + glyph, default), tile (soft-tint rounded square + glyph), dot (small status dot + halo) | `avatar` \| `tile` \| `dot` |
| itemTemplate.tileVariant | no | statistic rowVariant: the tile's antd Card `variant`. outlined (default) frames each tile; borderless draws none, for a strip that already sits in a Card | `outlined` \| `borderless` |
| itemTemplate.highlight | no | statistic rowVariant: {dot.path} to a boolean the RESTAction computes. true draws the tile's border in its `color` (in the text colour when it has none), anything else leaves the neutral border. The tile never reads its own value to decide. Absent: the border follows `color`. A borderless tile has no border to highlight | string |
| itemTemplate.rowVariant | no | row layout: default (antd List.Item.Meta — avatar + stacked title/description) | tree (tight single-line mono Relations row: status dot + primaryText + muted inline subPrimaryText + right-aligned colored secondaryText) | card (full antd Card tile — icon-tile + name + version badge (subPrimaryText) + category tag (secondaryText) + description + a footer of rowActions as visible buttons — the Marketplace catalog grid) | chip (compact navigable filter pill — primaryText label + optional count, solid/amber when the item's active flag is set — the data-driven Marketplace facet chips; a chip whose data element carries `removable: true` is an applied filter: a trailing remove mark, the accessible name "Remove filter: <primaryText>", and its navigateTo is the URL without that value) | statistic (one tile of a stats strip: an antd Card holding an antd Statistic, primaryText the title, secondaryText the value, subPrimaryText a secondary caption; `color` tints the value and frame ONLY when it resolves, so the healthy majority stays neutral; without `grid` the tiles fill the row and reflow as it narrows) | `default` \| `tree` \| `card` \| `chip` \| `statistic` |
| itemTemplate.secondaryTextAsTag | no | render secondaryText as a soft-tint Tag pill (e.g. a category) instead of plain text | boolean |
| itemTemplate.subPrimaryTextMono | no | render subPrimaryText as a small mono bordered pill (e.g. an event involvedObject Kind/name ref) instead of plain sub-text | boolean |
| itemTemplate.ellipsis | no | one line each for primaryText and subPrimaryText in the default row, the full text in a tooltip (antd Typography ellipsis) | boolean |
| itemTemplate.navigateTo | no | per-item navigation target ({dot.path} template, e.g. {link}); when it resolves non-empty the row becomes clickable and navigates there (SPA route) | string |
| itemTemplate.health | no | tree rowVariant only: {dot.path} template to the child's health as the page header's worst-child pill counts it: ready | pending | unknown | notSynced | notReady, or excluded (not judged at all, e.g. a managed Secret the chart deliberately does not read). A row that resolves to one of these is counted as exactly that; any other value, or no health, falls back to the row's raw conditions, then its colour | string |
| itemTemplate.color | no | Resolves the row's accent colour per item, so colour carries meaning from the data rather than being fixed by the author. | object |
| itemTemplate.color.value | no | {dot.path} to the value the colour is chosen from. | string |
| itemTemplate.color.map | no | Maps a resolved value to a colour token, for example `Ready` to green. | object |
| itemTemplate.color.default | no | Colour used when the resolved value is absent from the map. | string |
| itemTemplate.status | no | an at-a-glance status indicator (a Font Awesome glyph) rendered top-right of the `card` rowVariant. Each field is a {dot.path} resolved per item; the raw-value -> glyph/colour mapping is computed server-side (jq in the RESTAction), so the widget stays strongly typed. E.g. a blueprint's CompositionDefinition Ready condition resolved to {readyIcon}/{readyColor}/{readyReason}. | object |
| itemTemplate.status.icon | no | {dot.path} to the resolved Font Awesome icon name (e.g. {readyIcon}) | string |
| itemTemplate.status.color | no | {dot.path} to the resolved palette colour (e.g. {readyColor}) | string |
| itemTemplate.status.tooltip | no | {dot.path} tooltip text shown on hover (e.g. {readyReason}) | string |
| itemTemplate.bar | no | per-row horizontal Progress bar (the reconciliation-rail row): an antd Progress line whose percent + stroke colour are resolved per item | object |
| itemTemplate.bar.percent | no | {dot.path} to a 0-100 number (e.g. {healthPercent}) | string |
| itemTemplate.bar.color | no | Resolves the bar's stroke colour per item. | object |
| itemTemplate.bar.color.value | no | {dot.path} to the value the stroke colour is chosen from. | string |
| itemTemplate.bar.color.map | no | Maps a resolved value to a stroke colour token. | object |
| itemTemplate.bar.color.default | no | Stroke colour used when the resolved value is absent from the map. | string |
| itemTemplate.bar.label | no | optional trailing {dot.path} label (e.g. the % text or 7/7) | string |
| itemTemplate.bar.tooltip | no | {dot.path} tooltip text shown when the bar's label is hovered or focused (e.g. {rail.reason}). Resolving to empty leaves the label without a tooltip. | string |
| itemTemplate.bar.variant | no | Bar style: `line` for a standalone progress line, `rail` for the denser reconciliation-rail treatment. | `line` \| `rail` |
| itemTemplate.formats | no | Per-field rendering applied after each {dot.path} resolves. | object |
| itemTemplate.formats.primaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.secondaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.subPrimaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.formats.subSecondaryText | no | How the resolved value is rendered: `text` verbatim; or, when it is an ISO (RFC3339) time, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago, in a sentence ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). `relative` is the older name for `age` and `datetime` for `moment`. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. | `text` \| `age` \| `ago` \| `moment` \| `date` \| `datetime` \| `relative` |
| itemTemplate.rowActions | no | per-row action controls rendered on each row as a kebab (⋯) menu or as buttons (see rowActionsDisplay); each entry references an action id from widgetData.actions and is fired with the row's data as the action payload (customPayload). Distinct from navigateTo (whole-row click). | array |
| itemTemplate.rowActions[].actionId | yes | id of an action defined in widgetData.actions to fire when this menu item is clicked | string |
| itemTemplate.rowActions[].label | yes | menu item label | string |
| itemTemplate.rowActions[].icon | no | optional Font Awesome icon name for the menu item | string |
| itemTemplate.rowActions[].danger | no | render the menu item in a destructive (red) style | boolean |
| itemTemplate.rowActions[].type | no | the button's emphasis where row actions show as buttons (a List card footer, or rowActionsDisplay: buttons). Unset: the first action is primary and the rest default. Set default on the first to have no primary. Ignored in the kebab menu. | `primary` \| `default` |
| itemTemplate.rowActionsDisplay | no | how the default rowVariant presents rowActions: menu (a kebab (⋯) at the row's end, default) | buttons (antd Buttons at the row's end, in declared order: the first primary, the rest default, a danger entry as danger). The whole-row click (navigateTo) is unchanged either way. The card rowVariant always renders buttons. | `menu` \| `buttons` |
| sseEndpoint | no | optional SSE endpoint to stream items from (Krateo extension) | string |
| sseTopic | no | optional SSE subscription topic (Krateo extension) | string |
| prefix | no | Filters prefix (Krateo extension) | string |
| maxItems | no | max items kept when streaming (Krateo extension, default 200) | integer |
| actions | no | the actions of the widget (canonical map; see src/schemas/actions.schema.json). Referenced per-row by itemTemplate.rowActions. | object |
| actions.rest | no | rest api call actions triggered by the widget | array |
| actions.rest[].id | yes | unique identifier for the action | string |
| actions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| actions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| actions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| actions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| actions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| actions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| actions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| actions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| actions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| actions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| actions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| actions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| actions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| actions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate[].path | no | the identifier of the route to navigate to | string |
| actions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| actions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| actions.navigate[].type | yes | type of navigation action | `navigate` |
| actions.openDrawer | no | actions to open side drawer components | array |
| actions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| actions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| actions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| actions.openDrawer[].title | no | title shown in the drawer header | string |
| actions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |

---

### Markdown

Markdown receives markdown in string format and renders it gracefully

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| align | no | the alignment of the text: `left`, `center` or `right`. Absent: the alignment it inherits | `left` \| `center` \| `right` |
| allowCopy | no | displays a copy button on top of the widget to allow copy to clipboard | boolean |
| allowDownload | no | displays a download button on top of the widget to allow download of the text | boolean |
| downloadFileExtension | no | if 'allowDownload' is set, this property allows to set an extension for the downloaded file. Default is .txt | string |
| markdown | yes | markdown string to be displayed, GitHub-flavoured (pipe tables, strikethrough, task lists, bare URLs as links). Raw HTML is shown as text, except an `<a href="…">…</a>` anchor whose href is a quoted absolute http, https or mailto URL: it renders as a link, like `[text](url)`, and its other attributes are dropped A time in the text is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}`, `{moment:…}` ("4 Nov, 11:10") or `{date:…}`; inside `code` it is shown as written; a copy or download of the whole text carries every token as its words, code included. Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| tone | no | `secondary`: the text in the secondary text colour at the small size, as a muted line (links keep the link colour). Absent: the body text colour and size | `secondary` |


[Examples](../src/examples/widgets/Markdown/Markdown.example.yaml)

---

### Menu

antd Menu — navigation. `items` are inline nav entries: a `label`+`path` makes a visible sidebar entry and a route; a label-less item is a route-only (hidden) route. Content resolves by resourceRefId or the flexes/page-<slug> convention.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| mode | no | antd Menu mode (default inline) | `vertical` \| `horizontal` \| `inline` |
| theme | no | antd Menu theme | `light` \| `dark` |
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| items | yes | navigation entries (inline nav data); each references its content widget by resourceRefId or resolves via the path → flexes/page-<slug> convention. A label-less item registers a route with no sidebar entry. | array |
| items[].path | no | route path; '{param}' segments become :param and reach the content widget via ?extras. A label-less item registers a route with NO sidebar entry (hidden — e.g. detail/create/search). | string |
| items[].label | no | menu entry label; omit for a route-only (hidden) item | string |
| items[].icon | no | FontAwesome icon name shown beside the label (e.g. 'fa-inbox') | string |
| items[].order | no | sort weight for the entry | integer |
| items[].resourceRefId | no | id of the content widget (resolved via resourcesRefs, RBAC-aware). Optional — omit to use the path → flexes/page-<slug> convention. | string |
| items[].page | no | convention page-slug override → content is flexes/page-<slug>; set this for templated paths to avoid list-vs-detail collisions. | string |
| items[].namespace | no | the namespace the page lives in, used when its address comes from the flexes/page-<slug> convention; omit for the portal's own namespace. A resourceRefId that resolved wins over it | string |
| items[].linkOnly | no | the entry is a link to a path another entry's route serves (a page's krateo.io/nav-link-only): it shows in the sidebar and registers no route. It has no page of its own, so no resourceRefId | boolean |
| items[].group | no | sidebar section the entry belongs to (a page's krateo.io/nav-group). Consecutive entries with the same group render under one heading with this name; an entry without one has no heading | string |
| items[].type | no | set to 'divider' to render a visual separator at this order position; no path or label needed | `divider` |

---

### PageHeader

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| title | yes | the page title (H1). The one required field — a page header without a title is not a page header | string |
| counter | no | an optional count rendered in brackets beside the title, on the title's own type step (e.g. '(397)'). Use for 'how many of these are there', never for a status | integer |
| counterLabel | no | the noun the counter counts, rendered inside the same brackets (e.g. '23 blueprints'). Use it when WHAT is being counted changes — a bare '(23)' beside a filtered catalog does not say 23 of what | string |
| subtitle | no | one line of supporting context below the title. Must NOT restate the title — say it once per page. A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"), e.g. "Composition · ns · created {ago:2026-11-04T10:10:27Z}". Never an age computed in jq: snowplow caches the rendered text with `now` frozen. | string |
| tags | no | status pills on the title line, vertically centred with it | array |
| tags[].label | yes | the pill text. Required: a colour with no label carries meaning by colour alone, which a screen reader and a colourblind reader both miss | string |
| tags[].color | no | a palette colour NAME (resolved through the shared palette, never an antd preset or a hex) | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| note | no | a quiet line of muted text after the pills on the title line, e.g. "about the previous version · updating": what the pills say is true but about to change. Absent or empty text, nothing is drawn | object |
| note.text | yes | the note, in plain words; an empty string draws nothing | string |
| note.tooltip | no | the longer explanation shown on hover and focus | string |
| progress | no | something on this page is in progress (an analysis, a check): one line under the title saying since when, with the time waited ticking in the browser while `live` is true ("Re-analysis since 21 Nov, 12:54 · 12 minutes"). No ETA. The page itself updates when the state changes; this line only keeps the wait visible. null means no progress line: a RESTAction that has nothing in progress sends null, because a widgetDataTemplate cannot leave the path unset (snowplow writes "" for no output) and the CRD must admit what it then writes. | object | null |
| allowedResources | no | the list of resources that are allowed to be children of this widget or referenced by it | array |
| items | no | the page's actions, rendered on ONE row on the right edge, vertically centred on the title and subtitle together (level with the title when there is no subtitle); never stacked (design rule P26). At most one should be `type: primary` | array |
| items[].resourceRefId | yes | Handle of the child to render here, matching an `id` in spec.resourcesRefs. | string |

---

### Paragraph

Paragraph is a simple component used to display a block of text

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| text | yes | the content of the paragraph (the antd Typography children, as text). A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"). Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| level | no | when set, render as an antd Typography.Title heading of this level (h1-h5) instead of a body paragraph | `1` \| `2` \| `3` \| `4` \| `5` |
| type | no | antd Typography type | `secondary` \| `success` \| `warning` \| `danger` |
| variant | no | render style variant. eyebrow renders a small uppercase mono section caption (IBM Plex Mono letter-spaced muted) for page-header / panel eyebrows | `eyebrow` |
| strong | no | antd Typography strong | boolean |
| italic | no | antd Typography italic | boolean |
| underline | no | antd Typography underline | boolean |
| delete | no | antd Typography delete (strikethrough) | boolean |
| code | no | antd Typography code | boolean |
| mark | no | antd Typography mark (highlight) | boolean |
| disabled | no | antd Typography disabled | boolean |
| copyable | no | antd Typography copyable | boolean |
| ellipsis | no | antd Typography ellipsis | boolean |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Paragraph/Paragraph.example.yaml)

---

### PieChart

PieChart wraps the @ant-design/charts Pie component (AntV G2). It mirrors that library's data + field-mapping API.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| data | yes | chart data records (G2 `data`) | array |
| angleField | yes | field mapped to the slice value / angle (G2 `angleField`) | string |
| colorField | yes | field mapped to color / category (G2 `colorField`) | string |
| colorMap | no | map each colorField category to a Krateo palette color name (e.g. {"Healthy":"green","Failed":"red"}); sets the G2 color scale domain/range for semantic slice colors | object |
| innerRadius | no | donut hole as a percentage of the radius, 0-100 (maps to antd Pie `innerRadius` ÷ 100); omit for a full pie | integer |
| legend | no | show the legend; false hides it (G2 `legend`). When shown it is rendered centered, positioned per legendPosition (default below the chart). | boolean |
| legendPosition | no | where the legend sits relative to the chart (G2 legend position). Default bottom; right stacks it beside the donut (status-breakdown layout) | `bottom` \| `right` \| `top` \| `left` |
| label | no | per-slice label config passed through to G2 (e.g. {"text":"count","position":"inside"}); omit for no slice labels | object |
| annotations | no | G2 annotations passed through (e.g. a donut center `text` annotation positioned at x/y 50%) | array |
| title | no | chart title (G2 `title`) | string |
| height | no | fixed height in px (G2 `height`); omit to autofit | integer |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/PieChart/PieChart.example.yaml)

---

### Progress

Progress displays the completion status of an operation as a line, circle or dashboard gauge

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| percent | yes | the completion percentage (0-100) | integer |
| type | no | the visual type of the progress indicator | `line` \| `circle` \| `dashboard` |
| status | no | the status of the progress indicator | `success` \| `exception` \| `normal` \| `active` |
| strokeColor | no | the color of the progress stroke | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| showInfo | no | whether to display the progress value text | boolean |
| size | no | the size of the progress indicator | `default` \| `small` |
| steps | no | render the progress as a discrete number of steps | integer |
| label | no | optional primary readout rendered below the indicator, tinted in the strokeColor (e.g. a circle gauge's "Healthy · 100% converged" headline) | string |
| description | no | optional secondary readout (muted graphite) rendered under `label` (e.g. "all conditions True") | string |


[Examples](../src/examples/widgets/Progress/Progress.example.yaml)

---

### QRCode

QRCode renders a scannable QR code for a value

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| value | yes | the encoded value | string |
| size | no | the size in pixels | integer |
| bordered | no | whether to draw a border | boolean |


[Examples](../src/examples/widgets/QRCode/QRCode.example.yaml)

---

### Radio

Radio is a form-control widget wrapping Ant Design Radio.Group. It renders inside a Form widget's context and binds its value by `name`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule | boolean |
| defaultValue | no | antd Form.Item `initialValue` | string |
| options | yes | antd Radio.Group `options` | array |
| options[].label | no | option label (defaults to value) | string |
| options[].value | yes | option value | string |
| options[].disabled | no | antd option `disabled` | boolean |
| optionType | no | antd Radio.Group `optionType` | `default` \| `button` |
| buttonStyle | no | antd Radio.Group `buttonStyle` | `outline` \| `solid` |
| size | no | antd Radio.Group `size` | `small` \| `middle` \| `large` |
| disabled | no | antd Radio.Group `disabled` | boolean |


[Examples](../src/examples/widgets/Radio/Radio.example.yaml)

---

### RangePicker

RangePicker wraps Ant Design DatePicker.RangePicker as a standalone URL-bound filter (NOT a Form control). The selected [start, end] window is written to the `from`/`to` query params (epoch seconds) plus `range=custom`, so a data source can time-window server-side via request extras. Clearing removes those params.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| placeholder | no | antd RangePicker `placeholder` ([start, end]) | array |
| format | no | antd RangePicker `format` (display format) | string |
| size | no | antd RangePicker `size` | `small` \| `middle` \| `large` |
| allowClear | no | antd RangePicker `allowClear` | boolean |
| disabled | no | antd RangePicker `disabled` | boolean |

---

### Result

Result shows the outcome of an operation with a status icon

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| status | no | the result status | `success` \| `error` \| `info` \| `warning` |
| title | no | the result title | string |
| subTitle | no | the result detail text | string |


[Examples](../src/examples/widgets/Result/Result.example.yaml)

---

### Row

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| alignment | no | vertical alignment of items in the row (antd Row `align`). Default is 'stretch' (columns fill the row height so sibling cards stay equal-height when one wraps); set 'top'/'middle'/'bottom' to opt out | `top` \| `middle` \| `bottom` \| `stretch` |
| items | yes | the items of the row | array |
| items[].resourceRefId | yes | Handle of the child to render here, matching an `id` in spec.resourcesRefs. | string |
| items[].size | no | the number of cells that the item will occupy, from 0 (not displayed) to 24 (occupies all space) | integer |
| items[].xs | no | antd Col xs span — responsive override of `size` at narrow widths / a shrunk content column (e.g. when the Autopilot rail is open) | integer |
| items[].sm | no | antd Col sm span | integer |
| items[].md | no | antd Col md span | integer |
| items[].lg | no | antd Col lg span | integer |
| items[].xl | no | antd Col xl span | integer |
| items[].xxl | no | antd Col xxl span | integer |
| items[].alignment | no | Krateo-only: horizontal alignment of the widget inside its cell (no antd Col equivalent; applied via flex justify-content). Default is 'left' | `center` \| `left` \| `right` |


[Examples](../src/examples/widgets/Row/Row.example.yaml)

---

### Segmented

Segmented renders an antd Segmented: a row of mutually exclusive choices that switches the VIEW of a page (a range: 1h / 6h / 24h; a layout: Table / Graph; a scope: Mine / All). It is standalone and URL-bound: the choice lives in a URL search param (`queryParam`), so a link names it, the back button undoes it, and data sources read it as request `extras`, as the URL-bound Select and RangePicker do. For a choice that is a form field, use Radio with `optionType: button`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| queryParam | yes | the URL search param the choice is read from and written to (eg: `range` → `?range=6h`). Other params on the URL are kept | string |
| options | yes | the choices, in order (antd Segmented `options`) | array |
| options[].value | yes | what is written to `?<queryParam>=` | string |
| options[].label | no | the text drawn in the segment. Unset, the value; set to an empty string with an `icon`, an icon-only segment (then give it a `tooltip`, which is also its accessible name) | string |
| options[].icon | no | a font awesome icon name drawn before the label (eg: `fa-table`) | string |
| options[].tooltip | no | a tooltip on the segment (antd option `tooltip`) | string |
| options[].disabled | no | show the segment but do not let it be chosen (antd option `disabled`) | boolean |
| defaultValue | no | the choice shown while the URL has no `?<queryParam>=`. Choosing it removes the param, so the page's plain address stays its default. Unset, the first option | string |
| ariaLabel | no | what the group of choices is, for a screen reader (eg: `Time range`): the segments name the options, not the question | string |
| size | no | antd Segmented `size` | `small` \| `middle` \| `large` |
| shape | no | antd Segmented `shape`: `round` draws pill-shaped segments | `default` \| `round` |
| block | no | fill the container's width, the segments sharing it equally (antd Segmented `block`) | boolean |
| vertical | no | stack the segments vertically (antd Segmented `vertical`) | boolean |
| disabled | no | disable every segment (antd Segmented `disabled`) | boolean |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Segmented/Segmented.example.yaml)

---

### Select

Select is a form-control widget wrapping Ant Design Select. It renders inside a Form widget's context and binds its value by `name`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| required | no | add a required validation rule | boolean |
| defaultValue | no | antd Form.Item `initialValue` | string |
| options | yes | antd Select `options` | array |
| options[].label | no | option label (defaults to value) | string |
| options[].value | yes | option value | string |
| options[].disabled | no | antd option `disabled` | boolean |
| options[].group | no | the heading this option is listed under (antd OptGroup). Options of one group are drawn together, groups in the order they first appear; options without one have no heading. One select lists every group's options alike | string |
| options[].hint | no | what the value is called elsewhere, drawn muted at the row's end and read with the label (a tenant's namespace: "acme", "tenant-acme") | string |
| options[].count | no | how many items carry this value (a facet count), shown beside the label and read as part of the option's accessible name ("Alert, 47"). When options carry counts, the multi-select panel's master row shows their sum instead of the number of options. | integer |
| mode | no | antd Select `mode` | `multiple` \| `tags` |
| placeholder | no | antd Select `placeholder` | string |
| prefix | no | antd Select `prefix`: text drawn inside the trigger before the value, e.g. the facet name ("Kind"), so a row of filter Selects reads "Kind · All", "Repo · All". | string |
| size | no | antd Select `size` | `small` \| `middle` \| `large` |
| disabled | no | antd Select `disabled` | boolean |
| allowClear | no | antd Select `allowClear` | boolean |
| queryParam | no | when set, the Select is STANDALONE and URL-query-bound (not a Form.Item control): its value reads from / writes to this URL search param (e.g. 'project'), flowing to server-side `extras` like RangePicker. Omit for the default Form control behavior. | string |
| summary | no | how several picked values read in the closed control, with {count} replaced ("{count} namespaces"); one reads as its label (URL-bound `mode: multiple` only). Absent, each picked value is a removable tag | string |
| panelFooter | no | the footnote under the multi-select panel's Clear / Apply (URL-bound `mode: multiple` only). Absent, the panel keeps the project switcher's own footnote, "scope persists across pages via ?<queryParam>="; an empty string draws no footnote. | string |


[Examples](../src/examples/widgets/Select/Select.example.yaml)

---

### Slider

Slider is a form-control widget wrapping Ant Design Slider. It renders inside a Form widget's context and binds its value by `name`. (min/max/step are integers — controller-gen rejects floats.)

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| defaultValue | no | antd Form.Item `initialValue` | integer |
| min | no | antd Slider `min` | integer |
| max | no | antd Slider `max` | integer |
| step | no | antd Slider `step` | integer |
| disabled | no | antd Slider `disabled` | boolean |


[Examples](../src/examples/widgets/Slider/Slider.example.yaml)

---

### Splitter

Splitter divides an area into panels side by side (or stacked) that the reader resizes by dragging the bar between them; each panel holds a child widget

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the resource plurals this container may hold as children. Typed loosely on purpose; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| orientation | no | antd Splitter `orientation`: `horizontal` sets the panels side by side, `vertical` stacks them. Default horizontal. | `horizontal` \| `vertical` |
| height | no | the splitter's height in pixels. A vertical splitter needs one, since its panels share it; absent, a horizontal splitter is as tall as its tallest panel. | integer |
| lazy | no | antd Splitter `lazy`: the panels take their new sizes when the bar is released, not while it is dragged. For panels whose content is costly to lay out (a large table, a chart). | boolean |
| items | yes | the panels, in order (left to right, or top to bottom). | array |
| items[].resourceRefId | yes | the identifier of the k8s custom resource drawn inside the panel | string |
| items[].defaultSize | no | antd Splitter.Panel `defaultSize`: the panel's starting size, in percent ("25%") or pixels ("240px"). Absent, the panels without one share the space left equally. | string |
| items[].min | no | antd Splitter.Panel `min`: the smallest the reader can drag the panel to, "NN%" or "NNpx". | string |
| items[].max | no | antd Splitter.Panel `max`: the largest the reader can drag the panel to, "NN%" or "NNpx". | string |
| items[].resizable | no | antd Splitter.Panel `resizable`: false fixes the panel at its size. Default true. | boolean |
| items[].collapsible | no | which edge of the panel shows a button that folds it shut: `start` (its left or top edge), `end` (its right or bottom edge), or `both`. Absent, the panel cannot be folded. | `start` \| `end` \| `both` |


[Examples](../src/examples/widgets/Splitter/Splitter.example.yaml)

---

### Statistic

Statistic highlights a single numeric value

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| title | no | the statistic label | string |
| value | yes | the statistic value | integer | string |
| format | no | when `value` is an ISO (RFC3339) time, how it is written, in the viewer's time zone with the full date ("Wed 4 November 2026, 11:10:27 (UTC+1)") on hover and focus: `age` how old ("7 weeks"), `ago` how long ago ("52 minutes ago"), `moment` a point in time ("4 Nov, 11:10"; "10 Sep 2025, 09:30" in another year), `date` the day alone ("4 Nov"). Written in the browser, so it is never stale in snowplow's cache as a jq-computed "5m ago" is. Send the ISO time, never a pre-formatted one: a value that is not a time is shown as it came. Absent: the value is shown as it came. | `age` \| `ago` \| `moment` \| `date` |
| precision | no | the number of decimal places | integer |
| prefix | no | text shown before the value | string |
| suffix | no | text shown after the value | string |
| valueStyle | no | antd Statistic `valueStyle` — inline style for the numeral, primarily `color` for a semantic value (e.g. Healthy=cyan, Failed=crimson). Accepts a CSS color incl. theme vars like var(--cyan-color). | object |
| valueStyle.color | no | CSS color (hex or var(--token)) | string |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Statistic/Statistic.example.yaml)

---

### Steps

Steps displays a sequence of numbered steps that guide the user through a process

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| current | no | the index of the current step (0-based) | integer |
| reviewCurrent | no | the step to show as current (0-based) while a Form on the same page shows its Review step (`reviewBeforeSubmit`). Not an antd prop: a wizard's header and its Form are separate widgets, and this is how the header follows the review. Unset, `current` never changes. | integer |
| items | yes | the steps to display | array |
| items[].title | yes | the title of the step | string |
| items[].eyebrow | no | a short eyebrow label shown ABOVE the title (e.g. `Step 1`) — rendered mono/uppercase | string |
| items[].description | no | the description of the step | string |
| items[].subTitle | no | the subtitle of the step | string |
| items[].status | no | the status of this step | `wait` \| `process` \| `finish` \| `error` |
| items[].icon | no | a font awesome icon name for the step (eg: `fa-user`) | string |
| items[].resourceRefId | no | optional id of a widget to render inline below this step's description (e.g. an action button for the active step) | string |
| orientation | no | the layout orientation of the steps (antd Steps `orientation`) | `horizontal` \| `vertical` |
| size | no | the size of the steps | `default` \| `small` |
| status | no | the status of the current step | `wait` \| `process` \| `finish` \| `error` |
| titlePlacement | no | where the title is placed relative to the step icon (antd Steps `titlePlacement`) | `horizontal` \| `vertical` |
| type | no | the visual type of the steps | `default` \| `navigation` \| `inline` |


[Examples](../src/examples/widgets/Steps/Steps.example.yaml)

---

### Switch

Switch is a form-control widget wrapping Ant Design Switch. It renders inside a Form widget's context and binds its boolean value by `name`.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | yes | form field key — antd Form.Item `name` | string |
| label | no | antd Form.Item `label` | string |
| defaultChecked | no | initial checked state — antd Form.Item `initialValue` | boolean |
| disabled | no | antd Switch `disabled` | boolean |
| size | no | antd Switch `size` | `default` \| `small` |
| checkedChildren | no | antd Switch `checkedChildren` (on-state label) | string |
| unCheckedChildren | no | antd Switch `unCheckedChildren` (off-state label) | string |


[Examples](../src/examples/widgets/Switch/Switch.example.yaml)

---

### Table

Table displays structured data with customizable columns and pagination

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| columns | yes | configuration of the table's columns | array |
| columns[].color | no | the color of the value (or the icon) to be represented. These are KRATEO PALETTE names resolved through the shared palette — not antd presets. The same name on a Button takes antd's vocabulary instead and renders a different shade. | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| columns[].title | yes | column header label | string |
| columns[].valueKey | yes | key used to extract the value from row data | string |
| columns[].width | no | antd Table column width — a pixel number, or any CSS length string. Mirrors antd ColumnType.width. Optional: omitted, antd sizes the column as it does today. | integer | string |
| columns[].minWidth | no | antd Table column minWidth in px. Mirrors antd ColumnType.minWidth. Usually the better lever under fitContent: a fixed width re-creates the overflow it was meant to fix, while a floor keeps a column readable and lets the others flex. | integer |
| dataSource | no | antd Table dataSource — the table rows (renamed from `data`; `data` still accepted for back-compat) | array |
| pagination | no | antd Table pagination config (subproperties mirror antd). | object |
| pagination.pageSize | no | number of rows per page | integer |
| pagination.defaultPageSize | no | default page size | integer |
| pagination.total | no | server-side pagination: the TOTAL row count across all pages (the widget's `dataSource` holds only the current page/window). Set by the widgetDataTemplate from the full list length so the pager renders the correct number of pages. When present, the Table uses controlled server-side pagination (each page fetched on demand) instead of client-side slicing of dataSource. | integer |
| pagination.current | no | server-side pagination: the 1-based current page (controlled). Usually driven by the request `page` param, not the CR. | integer |
| pagination.hideOnSinglePage | no | hide the pager when there is a single page | boolean |
| pagination.simple | no | use the simple pager | boolean |
| pagination.position | no | pager position(s) | array |
| bordered | no | antd Table bordered | boolean |
| fitContent | no | Fit columns to the container instead of horizontal-scrolling: a wide cell ellipsis-truncates (full text on hover) rather than pushing a scrollbar. Ignored for virtualized (very large) tables. | boolean |
| resizableColumns | no | Whether the reader can resize the columns by dragging the right edge of a header (or with the arrow keys on its handle). On when omitted; set false to keep the columns at the widths the table lays out. Widths a reader set are remembered per viewer in the browser, and ignored while this is false. | boolean |
| size | no | antd Table size. Defaults to 'middle' when omitted (matching Button), so an unset value has a documented, Brand-consistent density rather than antd's raw default | `large` \| `middle` \| `small` |
| prefix | no | it's the filters prefix to get right values | string |
| rowNavigateTo | no | optional route path to navigate to on row click; `{valueKey}` placeholders are filled from that row's cells (e.g. /compositions/{ns}/{name}) | string |
| rowActions | no | per-row action controls, rendered in a trailing column of each row as a kebab (⋯) menu or as buttons (see rowActionsDisplay) — the same field List takes as itemTemplate.rowActions. Each entry references an action id from widgetData.actions and is fired with the row's values as the action payload (customPayload): an object of each cell's valueKey to its value, so a navigate path of /x/${name} goes to that row's `name` cell. A click or key on a control never fires the row's rowNavigateTo, which keeps working everywhere else on the row. | array |
| rowActions[].actionId | yes | id of an action defined in widgetData.actions to fire when this menu item is clicked | string |
| rowActions[].label | yes | menu item label | string |
| rowActions[].icon | no | optional Font Awesome icon name for the menu item | string |
| rowActions[].danger | no | render the menu item in a destructive (red) style | boolean |
| rowActions[].type | no | the button's emphasis where row actions show as buttons (a List card footer, or rowActionsDisplay: buttons). Unset: the first action is primary and the rest default. Set default on the first to have no primary. Ignored in the kebab menu. | `primary` \| `default` |
| rowActionsDisplay | no | how rowActions are presented: menu (a kebab (⋯) in the row's last cell, default) | buttons (antd Buttons in the row's last cell, in declared order: the first primary, the rest default, a danger entry as danger). The whole-row click (rowNavigateTo) is unchanged either way. Same field and values as List's itemTemplate.rowActionsDisplay. | `menu` \| `buttons` |
| actions | no | the actions of the widget (canonical map; see src/schemas/actions.schema.json). Referenced per-row by rowActions. | object |
| actions.rest | no | rest api call actions triggered by the widget | array |
| actions.rest[].id | yes | unique identifier for the action | string |
| actions.rest[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.rest[].requireConfirmation | no | whether user confirmation is required before triggering the action | boolean |
| actions.rest[].errorMessage | no | a message that will be displayed inside a toast in case of error | string |
| actions.rest[].fanOutPath | no | name of an ARRAY field in the submitted values: the action fans out into ONE ordered write per element (for each write, that field is replaced by the single element before payload/payloadToOverride interpolation). The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics); onEventNavigateTo is not supported on a fan-out action | string |
| actions.rest[].ops | no | ordered list of DISTINCT writes applied as ONE gated set (e.g. one Form submit creating a Role AND its RoleBinding): each op resolves its OWN resourceRefId (verb + path + payload base) and builds its OWN payload/payloadToOverride against the SAME submitted values. The whole set is gated behind ONE aggregated blast-radius confirm and dispatched sequentially with stop-on-first-error and per-item results (W0-4 applySet semantics). Mutually exclusive with fanOutPath; onEventNavigateTo is not supported on a multi-op action. The action's own top-level payload/payloadToOverride are IGNORED when ops is present and its top-level resourceRefId is ignored for dispatch (it must still name a valid resource ref — point it at the first op's) | array |
| actions.rest[].ops[].resourceRefId | yes | the identifier of the resource ref this op targets: its verb (must be mutating), path and payload base | string |
| actions.rest[].ops[].payload | no | static payload sent with this op's request | object |
| actions.rest[].ops[].payloadToOverride | no | list of this op's payload fields to override dynamically (values interpolate against the same submitted values as every other op) | array |
| actions.rest[].ops[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].ops[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].successMessage | no | a message that will be displayed inside a toast in case of success | string |
| actions.rest[].onSuccessNavigateTo | no | url to navigate to after successful execution | string |
| actions.rest[].onEventNavigateTo | no | conditional navigation triggered by a specific event | object |
| actions.rest[].onEventNavigateTo.eventReason | yes | identifier of the awaited event reason | string |
| actions.rest[].onEventNavigateTo.url | yes | url to navigate to when the event is received | string |
| actions.rest[].onEventNavigateTo.timeout | no | the timeout in seconds to wait for the event | integer |
| actions.rest[].onEventNavigateTo.reloadRoutes | no | Re-fetch the route table before navigating. Set it when the action creates its own destination — publishing a new page, for example — so the route exists by the time the navigation happens. | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.rest[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.navigate[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.navigate[].path | no | the identifier of the route to navigate to | string |
| actions.navigate[].resourceRefId | no | the identifier of the k8s custom resource that should be represented | string |
| actions.navigate[].requireConfirmation | no | whether user confirmation is required before navigating | boolean |
| actions.navigate[].type | yes | type of navigation action | `navigate` |
| actions.openDrawer | no | actions to open side drawer components | array |
| actions.openDrawer[].id | yes | unique identifier for the drawer action | string |
| actions.openDrawer[].type | yes | type of drawer action | `openDrawer` |
| actions.openDrawer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openDrawer[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openDrawer[].size | no | drawer size to be displayed | `default` \| `large` |
| actions.openDrawer[].title | no | title shown in the drawer header | string |
| actions.openDrawer[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openDrawer[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no | Whether this action shows an in-flight indicator while it runs. | object |
| actions.openModal[].loading.display | yes | Show the in-flight indicator. Set false to run the action without one. | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Table/Table.example.yaml)

---

### Tabs

Tabs display a set of tab items for navigation or content grouping

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| type | no | antd Tabs type | `line` \| `card` \| `editable-card` |
| size | no | antd Tabs size | `small` \| `middle` \| `large` |
| tabPlacement | no | antd Tabs tabPlacement | `top` \| `end` \| `bottom` \| `start` |
| centered | no | antd Tabs centered | boolean |
| allowedResources | yes | the list of resources that are allowed to be children of this widget or referenced by it | array |
| items | yes | the items of the tab list | array |
| items[].label | no | text displayed on the tab | string |
| items[].resourceRefId | yes | the identifier of the k8s custom resource represented by the tab content | string |
| items[].title | no | optional title to be displayed inside the tab | string |


[Examples](../src/examples/widgets/Tabs/Tabs.example.yaml)

---

### Tag

Tag displays a small categorical label

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| label | yes | the tag text. A time in it is a token the browser writes, in the viewer's time zone with the full date on hover: `{ago:2026-11-04T10:10:27Z}` ("3 weeks ago"), `{age:…}` ("3 weeks"), `{moment:…}` ("4 Nov, 11:10") or `{date:…}` ("4 Nov"). Never a time formatted in jq: it is in UTC, and an age is frozen in snowplow's cache. | string |
| color | no | the tag color (preset name or hex) | string |
| variant | no | antd Tag variant | `filled` \| `solid` \| `outlined` |
| style | no | inline CSS style object passed through to the antd Tag (e.g. {"fontSize":"15px"}) | object |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Tag/Tag.example.yaml)

---

### Theme

Theme applies tenant brand overrides app-wide (Brand v2, issue #49 §7). It renders no visible UI — a side-effect widget that sets CSS custom properties on :root. Mount one globally (e.g. in the app-shell).

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| mode | no | when set, PIN the color mode (overrides the user's light/dark toggle preference for this tenant) | `dark` \| `light` |
| logo | no | tenant brand logo (used on the login panel; sider brand is chart-driven) | object |
| logo.url | no | logo image URL | string |
| logo.alt | no | logo alt text | string |
| token | no | overridable Tier-1 design tokens. Applied as CSS custom properties (--krateo-* / legacy --*-color) at runtime, so CSS-module and index.css styling re-tint. Only these named tokens are overridable. | object |
| token.colorPrimary | no | brand/interaction colour → --primary-color + --krateo-color-action-primary | string |
| token.colorBgLayout | no | page background → --background-color + --krateo-color-background-base | string |
| token.colorBgContainer | no | card/panel surface → --panelbg-color + --krateo-color-background-surface | string |
| token.colorBorder | no | hairline border → --border-color + --krateo-color-border-subtle | string |
| token.colorText | no | default text → --text-color + --krateo-color-text-default | string |
| token.fontFamily | no | UI font stack → --font-family + --krateo-font-ui | string |
| token.fontSize | no | base font size in px | integer |
| custom | no | non-token brand chrome overrides (sidebar + nav) | object |
| custom.sidebar | no | sidebar rail gradient stops (→ --krateo-nav-gradient-* / --menubgstart/end-color) | object |
| custom.sidebar.bgGradientStart | no | Start colour of the sidebar background gradient. | string |
| custom.sidebar.bgGradientEnd | no | End colour of the sidebar background gradient. | string |
| custom.menu | no | sidebar nav-item colours (→ --menuitem-color / --menuitembg-color / --krateo-nav-item*) | object |
| custom.menu.itemColor | no | Text colour of an idle menu item. | string |
| custom.menu.itemHoverColor | no | Text colour of a menu item under the pointer. | string |
| custom.menu.itemSelectedBg | no | Background of the selected menu item. | string |
| custom.menu.itemSelectedColor | no | Text colour of the selected menu item. | string |

---

### Timeline

Timeline displays a vertical (or horizontal) sequence of events in chronological order

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| allowedResources | no | the resource plurals this container may hold as children. Typed loosely on purpose — the per-widget enums drifted and enforced nothing; containment is checked by the chart lint (design rule X5) against the real widget registry. | array |
| items | yes | the timeline nodes, in display order (antd Timeline `items`) | array |
| items[].title | no | the label on the opposite side of the rail, e.g. a timestamp (antd item `title`, formerly `label`) | string |
| items[].content | no | the body of the node, e.g. the event reason and message (antd item `content`, formerly `children`) | string |
| items[].color | no | the dot colour: a palette colour NAME (resolved through the shared palette for the light or dark mode, never an antd preset or a hex). Unset, the dot takes the primary colour | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| items[].icon | no | a font awesome icon name rendered instead of the dot (eg: `fa-check`) (antd item `icon`, formerly `dot`) | string |
| items[].placement | no | which side of the rail the content sits on when `mode` is `alternate` (antd item `placement`, formerly `position`) | `start` \| `end` |
| items[].loading | no | render this node as in-progress (a spinning dot). Replaces antd's deprecated `pending` prop | boolean |
| items[].resourceRefId | no | optional id of a widget to render inline below this node's content (e.g. a button opening the event's object) | string |
| mode | no | where the content sits relative to the rail (antd Timeline `mode`) | `start` \| `end` \| `alternate` |
| orientation | no | the layout orientation of the timeline (antd Timeline `orientation`) | `vertical` \| `horizontal` |
| reverse | no | render the items in reverse order | boolean |
| titleSpan | no | how many of the 24 grid columns the `title` column takes (eg: `4` for a column of timestamps) (antd Timeline `titleSpan`) | integer |
| variant | no | the dot style (antd Timeline `variant`) | `outlined` \| `filled` |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Timeline/Timeline.example.yaml)

---

### Tree

Tree renders a hierarchy as an antd Tree: resources and what they own, a catalog by category, a folder layout. The nodes arrive as a FLAT list where each node names its parent (`parentKey`), because that is the shape a RESTAction's jq produces naturally and because a CRD schema cannot recurse. A node can open a page (`navigateTo`).

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| items | yes | the nodes, as a flat list. Siblings keep the order they have here. A node whose `parentKey` names no node in the list is shown at the root, so a filtered answer never loses a branch. | array |
| items[].key | yes | unique among the nodes: what `parentKey`, `defaultExpandedKeys` and `selectedKey` name (antd TreeNode `key`). When two nodes share a key, the first wins | string |
| items[].parentKey | no | the `key` of the node this one sits under. Unset, the node is a root | string |
| items[].title | yes | the node's label (antd TreeNode `title`) | string |
| items[].description | no | a short muted note after the title, in the data face (eg: a kind, a version, a count) | string |
| items[].icon | no | a font awesome icon name shown before the title (eg: `fa-folder`) (antd TreeNode `icon`) | string |
| items[].color | no | the icon colour: a palette colour NAME (resolved through the shared palette for the light or dark mode, never an antd preset or a hex). Unset, the icon takes the muted text colour | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| items[].navigateTo | no | the page selecting this node opens: an app path (eg: `/compositions/demo/my-app`) or an absolute URL. Unset, the node is not selectable | string |
| items[].disabled | no | show the node greyed out and not selectable (antd TreeNode `disabled`) | boolean |
| defaultExpandAll | no | open every node on first render (antd Tree `defaultExpandAll`) | boolean |
| defaultExpandedKeys | no | the nodes open on first render; their ancestors open with them (antd Tree `defaultExpandedKeys` with `defaultExpandParent`) | array |
| selectedKey | no | the node shown as selected, eg: the one whose page is open. Its ancestors open with it, so it is in view on first render | string |
| showLine | no | draw the connector lines between parent and children (antd Tree `showLine`) | boolean |
| height | no | a fixed height in pixels: the tree scrolls inside it and draws only the nodes in view, for large trees (antd Tree `height`, virtual scroll) | integer |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


[Examples](../src/examples/widgets/Tree/Tree.example.yaml)

---

### Upload

Upload lets the user select files and uploads them to a resolved backend endpoint (resourceRefId) with the current bearer token

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| resourceRefId | yes | the id of the resourceRef (in resourcesRefs) describing the upload target endpoint | string |
| label | no | the label shown on the upload control | string |
| name | no | antd Upload `name` — the multipart form field name for the file (defaults to `file`); legacy `fieldName` still accepted | string |
| listType | no | how the uploaded file list is rendered | `text` \| `picture` \| `picture-card` \| `picture-circle` |
| accept | no | the accepted file types (the input `accept` attribute, eg: `.json,.yaml`) | string |
| multiple | no | whether multiple files can be selected | boolean |
| directory | no | whether to allow selecting an entire directory | boolean |
| maxCount | no | the maximum number of files allowed | integer |
| successMessage | no | message displayed in a toast after a successful upload | string |
| errorMessage | no | message displayed in a toast when an upload fails | string |


[Examples](../src/examples/widgets/Upload/Upload.example.yaml)

---

### YamlViewer

YamlViewer receives a JSON string as input and renders its equivalent YAML representation for display.

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| json | yes | json string to be converted and displayed as yaml | string |


[Examples](../src/examples/widgets/YamlViewer/YamlViewer.example.yaml)
