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
generator preserves this header and rewrites everything from the `## Widgets` anchor down.

## Widgets

List of implemented widgets:

### Alert

Alert displays an inline contextual message

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| title | yes | the alert title | string |
| description | no | the alert detail text | string |
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
| actions.rest[].onEventNavigateTo.reloadRoutes | no |  | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no |  | object |
| actions.rest[].loading.display | yes |  | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no |  | object |
| actions.navigate[].loading.display | yes |  | boolean |
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
| actions.openDrawer[].loading | no |  | object |
| actions.openDrawer[].loading.display | yes |  | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no |  | object |
| actions.openModal[].loading.display | yes |  | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| color | no | antd Button color (pair with `variant`) | `default` \| `primary` \| `danger` \| `blue` \| `purple` \| `cyan` \| `green` \| `magenta` \| `pink` \| `red` \| `orange` \| `yellow` \| `volcano` \| `geekblue` \| `lime` \| `gold` |
| variant | no | antd Button variant (pair with `color`) | `outlined` \| `dashed` \| `solid` \| `filled` \| `text` \| `link` |
| danger | no | antd Button danger | boolean |
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
| items[].resourceRefId | yes |  | string |


[Examples](../src/examples/widgets/ButtonGroup/ButtonGroup.example.yaml)

---

### Card

Card is a container to display information

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| anchorId | no | renders this panel with a DOM id so an in-page `[text](#anchorId)` link (e.g. a summary/table-of-contents Markdown widget) scrolls to it | string |
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
| widgetActions.rest[].onEventNavigateTo.reloadRoutes | no |  | boolean |
| widgetActions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| widgetActions.rest[].type | yes | type of action to execute | `rest` |
| widgetActions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| widgetActions.rest[].payload | no | static payload sent with the request | object |
| widgetActions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| widgetActions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| widgetActions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| widgetActions.rest[].loading | no |  | object |
| widgetActions.rest[].loading.display | yes |  | boolean |
| widgetActions.navigate | no | client-side navigation actions | array |
| widgetActions.navigate[].id | yes | unique identifier for the action | string |
| widgetActions.navigate[].loading | no |  | object |
| widgetActions.navigate[].loading.display | yes |  | boolean |
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
| widgetActions.openDrawer[].loading | no |  | object |
| widgetActions.openDrawer[].loading.display | yes |  | boolean |
| widgetActions.openModal | no | actions to open modal dialog components | array |
| widgetActions.openModal[].id | yes | unique identifier for the modal action | string |
| widgetActions.openModal[].type | yes | type of modal action | `openModal` |
| widgetActions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| widgetActions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| widgetActions.openModal[].title | no | title shown in the modal header | string |
| widgetActions.openModal[].loading | no |  | object |
| widgetActions.openModal[].loading.display | yes |  | boolean |
| widgetActions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| widgetActions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| clickActionId | no | the id of the action to be executed when the panel is clicked | string |
| footer | no | footer section of the panel containing additional items | array |
| footer[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented, usually a widget | string |
| headerLeft | no | optional text to be displayed under the title, on the left side of the Card | string |
| extra | no | antd Card extra — content shown top-right of the card header (renamed from `headerRight`) | string |
| extraVariant | no | how `extra` renders top-right: `text` (default, plain), `badge` (glow dot + uppercase mono, for CONVERGED/DRIFT/DEGRADED), or `tag` (soft antd Tag pill — for Up to date / status labels) | `text` \| `badge` \| `tag` |
| extraStatus | no | colour token: antd Badge status for `extraVariant: badge`; antd Tag color for `extraVariant: tag` | `success` \| `processing` \| `warning` \| `error` \| `default` \| `green` \| `gold` \| `red` \| `blue` \| `violet` |
| extraRefId | no | resourceRefId of a widget (e.g. a Button) rendered top-right of the card header — a real, independently-actioned slot with its own icon/size/navigation, distinct from the plain-text `extra`. Mirrors the `cover`/`footer` widget slots; renders a nested WidgetRenderer, so it does NOT make the whole card the click target the way `extra` + `clickActionId` does. | string |
| live | no | show a pulsing "Live" badge next to the card title (for cards backed by a live/SSE feed) | boolean |
| legend | no | optional legend key shown top-right of the card header (e.g. the reconciliation-rail actual/drift/target swatches): each item is a small colour swatch + label | array |
| legend[].color | yes | swatch colour (palette name, e.g. cyan / magenta / amber) | string |
| legend[].label | yes | swatch label (e.g. actual / drift / target) | string |
| variant | no | antd Card variant | `outlined` \| `borderless` |
| size | no | antd Card size | `default` \| `small` |
| cover | no | resourceRefId of a widget rendered as the antd Card cover | string |
| icon | no | icon displayed in the panel header | object |
| icon.name | yes | name of the icon to display (font awesome icon name eg: `fa-inbox`) | string |
| icon.color | no | color of the icon | string |
| items | yes | list of resource references to display as main content in the panel | array |
| items[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented, usually a widget | string |
| tags | no | list of string tags to be displayed in the footer | array |
| title | no | text to be displayed as the panel title | string |
| titleVariant | no | how the panel title is rendered. 'heading' (default) = readable card heading (marketplace tiles, detail headers). 'eyebrow' = small mono uppercase letter-spaced muted caption (flight-deck section/panel labels). | `heading` \| `eyebrow` |
| tooltip | no | optional tooltip text shown on the top right side of the card to provide additional context | string |
| watch | no | live-refresh watch: involvedObject(s) this widget is tied to (see src/schemas/watch.schema.json). A matching k8s event refetches the widget. | array |
| watch[].apiVersion | yes | group/version, e.g. composition.krateo.io/v1alpha1 | string |
| watch[].kind | yes | e.g. DemoClaim | string |
| watch[].namespace | no | scope to a namespace; omit to match any | string |
| watch[].name | no | a specific object; omit to match any object of this kind ("GVR-level") | string |


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
| title | no | the title displayed above the description list | string |
| column | no | the number of label/value pairs per row (antd Descriptions `column`) | integer |
| bordered | no | whether to render cell borders (antd Descriptions `bordered`) | boolean |
| size | no | the size of the description list | `default` \| `middle` \| `small` |
| variant | no | rendering style. 'default' = antd Descriptions definition list; 'form' = read-only mirror of the create Form's property layout — each item a connector-rail field (bold label above a mono value), grouped into sections by the item's `section` (nested objects each become a labelled section) | `default` \| `form` |
| items | yes | the label/value pairs to display | array |
| items[].label | yes | the label of the item | string |
| items[].section | no | (variant:form only) the section this property is grouped under — e.g. a nested object's top-level key; empty/absent = the ungrouped top section | string |
| items[].value | yes | the value of the item (rendered as the antd Descriptions item children) | string |
| items[].span | no | how many columns this item spans (antd Descriptions item `span`) | integer |


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

### Filters



#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| prefix | yes | the prefix used to share filter values with the widgets being filtered | string |
| items | yes | resourceRefIds of form-control widgets (Input/Select/Switch/DatePicker/…) composed as filter fields. Each control's `name` is the dotted data path it filters; the match strategy is inferred from the value type. | array |
| items[].resourceRefId | yes | the identifier of the form-control widget to render as a filter field | string |


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
| items | yes | the child widgets rendered inside the Flex | array |
| items[].resourceRefId | yes |  | string |


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
| variant | no | resource: one node per live object, the original card. architecture: one node per resource a chart declares, drawn in the state the composition is in | `resource` \| `architecture` |


[Examples](../src/examples/widgets/FlowChart/FlowChart.example.yaml)

---

### Form

name of the k8s Custom Resource

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| layout | no | antd Form layout | `horizontal` \| `vertical` \| `inline` |
| size | no | antd Form size | `small` \| `middle` \| `large` |
| disabled | no | antd Form disabled (disables all fields) | boolean |
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
| actions.rest[].onEventNavigateTo.reloadRoutes | no |  | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no |  | object |
| actions.rest[].loading.display | yes |  | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no |  | object |
| actions.navigate[].loading.display | yes |  | boolean |
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
| actions.openDrawer[].loading | no |  | object |
| actions.openDrawer[].loading.display | yes |  | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no |  | object |
| actions.openModal[].loading.display | yes |  | boolean |
| actions.openModal[].customWidth | no | the custom width of the value, which should be used by setting the 'custom' value inside the 'size' property | string |
| actions.openModal[].size | no | sets the Modal size, 'default' is 520px, 'large' is 80% of the screen width, 'fullscreen' is 100% of the screen width, 'custom' should be used with the 'customWidth' property | `default` \| `large` \| `fullscreen` \| `custom` |
| buttonConfig | no | custom labels and icons for form buttons | object |
| buttonConfig.primary | no | primary button configuration | object |
| buttonConfig.primary.label | no | text label for primary button | string |
| buttonConfig.primary.icon | no | icon name for primary button | string |
| buttonConfig.secondary | no | secondary button configuration | object |
| buttonConfig.secondary.label | no | text label for secondary button | string |
| buttonConfig.secondary.icon | no | icon name for secondary button | string |
| buttonConfig.secondary.navigateTo | no | when set, the secondary button is a Cancel that navigates to this route (SPA) instead of resetting the form | string |
| buttonConfig.draft | no | draft button configuration — only rendered when widgetData.draftActionId is also set; clicking it persists the current (un-validated) field values via that action | object |
| buttonConfig.draft.label | no | text label for draft button | string |
| buttonConfig.draft.icon | no | icon name for draft button | string |
| buttonConfig.review | no | Configure-step button label when reviewBeforeSubmit is set (the button that opens the in-place Review; default 'Review →') | object |
| buttonConfig.review.label | no | text label for the Review button | string |
| buttonConfig.reviewBack | no | Review-step back button label when reviewBeforeSubmit is set (returns to editing; default '← Back to edit') | object |
| buttonConfig.reviewBack.label | no | text label for the back-to-edit button | string |
| initialValues | no | optional object with initial values for form fields. Keys should match form field names (supports nested objects). These values override schema defaults. | object |
| items | no | resourceRefIds of form-control widgets (Input, Select, Switch, …) to compose inside the Form. Composable mode — an alternative to the schema/stringSchema generator. | array |
| items[].resourceRefId | yes | the identifier of the form-control widget to render | string |
| schema | no | JSON schema (e.g. a blueprint CRD's openAPIV3Schema spec) rendered as form fields — the schema-driven alternative to `items`. Usually populated server-side via a widgetDataTemplate jq expression that extracts the spec schema. Note: a schema sourced from a CRD's openAPIV3Schema has its `properties` map serialized alphabetically (order lost); use `stringSchema` to preserve the source values.schema.json authoring order. | object |
| stringSchema | no | Same JSON schema as `schema`, but as a raw JSON STRING. Preferred over `schema` when present: the client JSON.parses it, preserving key insertion order, so fields render in the source values.schema.json order rather than the alphabetized order a CRD-sourced object schema yields. Typically populated server-side from the blueprint's per-version jsonschema ConfigMap (which keeps authoring order). Falls back to `schema` when absent or not valid JSON. | string |
| propertiesToHide | no | top-level schema property names to omit from the schema-driven form | array |
| reviewBeforeSubmit | no | when true (inline render only), the primary button validates and reveals an in-place read-only Review of the entered values before the real submit — the form stays mounted so 'Back to edit' preserves every value. Pair with buttonConfig.review / buttonConfig.reviewBack for custom labels. | boolean |
| submitDisabledWhenPristine | no | when true, the primary (submit) button stays disabled until at least one field differs from its initial value (initialValues overlaid on schema defaults). Use for update forms where submitting an unchanged value is a no-op — e.g. a version picker pre-set to the currently-installed version. | boolean |
| submitActionId | yes | the id of the action to be called when the form is submitted | string |
| draftActionId | no | optional id of an action fired by a 'Save draft' button that captures the CURRENT field values WITHOUT running form validation (so an incomplete form can be persisted). Pair with buttonConfig.draft to show the button. | string |
| submitActionSelector | no | optional field-conditional submit routing: when present, the submit action is chosen at submit time from the value of the named field. Routes one form to different create targets (e.g. a 'target cluster' select where 'local' posts the blueprint instance and a remote spoke posts a RemoteInstall). Falls back to `default` (or `submitActionId`) when the field value has no mapping. | object |
| submitActionSelector.field | yes | form field whose current value selects the submit action | string |
| submitActionSelector.map | yes | map of field-value → action id | object |
| submitActionSelector.default | no | action id used when the field value is not present in `map` | string |


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
| sider.width | no | antd Sider `width` in px | integer |
| sider.collapsible | no | antd Sider `collapsible` (renders a collapse trigger) | boolean |
| sider.collapsedWidth | no | antd Sider `collapsedWidth` in px | integer |
| sider.breakpoint | no | antd Sider responsive `breakpoint`; auto-collapses below it | `xs` \| `sm` \| `md` \| `lg` \| `xl` \| `xxl` |
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
| xTimeUnit | no | When set, `xField` values are treated as UNIX epoch SECONDS and formatted to a label in the BROWSER's local timezone at render: 'hour' -> 'HH:00', 'day' -> 'Mon D'. Use this instead of server-side strftime so a 21:00-Rome bucket reads 21:00 (not the server's UTC 19:00). Annotations sharing `xField` are localized identically so peak/now marks stay aligned. | `hour` \| `day` |
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
| grid.gutter | no |  | integer |
| grid.column | no |  | integer |
| grid.xs | no |  | integer |
| grid.sm | no |  | integer |
| grid.md | no |  | integer |
| grid.lg | no |  | integer |
| grid.xl | no |  | integer |
| grid.xxl | no |  | integer |
| itemLayout | no | antd List itemLayout | `horizontal` \| `vertical` |
| size | no | antd List size | `default` \| `large` \| `small` |
| bordered | no | antd List bordered | boolean |
| split | no | antd List split | boolean |
| loading | no | antd List loading | boolean |
| hideWhenEmpty | no | When there are no items, render nothing (null) instead of the antd Empty 'No data' placeholder. Enables a server-driven conditional section: the RA emits items only when a condition holds (e.g. compositions count == 0), so the section appears/disappears with the data without any client-side logic. | boolean |
| header | no | antd List header (ReactNode in antd; string here) | string |
| footer | no | antd List footer (ReactNode in antd; string here) | string |
| pagination | no | antd List pagination (serializable subset); presence enables client-side paging of the delivered dataSource (e.g. the ~400-card Marketplace grid). Server-side facet/search filters (?extras) shrink the array BEFORE it reaches the widget, so paging composes with them: antd clamps the current page into the filtered range, and a single-page result hides the pager entirely (exception-only chrome). Absent = antd default (no pagination). | object |
| pagination.pageSize | yes | antd pagination.pageSize — items per page | integer |
| pagination.position | no | antd List pagination.position (default bottom) | `top` \| `bottom` \| `both` |
| dataSource | no | antd List dataSource. Each element is a data object (rendered via itemTemplate) or { resourceRefId } (rendered as a child widget). | array |
| itemTemplate | no | serializable substitute for antd renderItem: maps a data element's fields to row slots ({dot.path}; {a|b} first-non-empty) | object |
| itemTemplate.primaryText | no |  | string |
| itemTemplate.secondaryText | no |  | string |
| itemTemplate.subPrimaryText | no |  | string |
| itemTemplate.subSecondaryText | no |  | string |
| itemTemplate.description | no | longer body line (2-line clamp); only rendered by the card rowVariant (e.g. a catalog tile description) | string |
| itemTemplate.cardCta | no | card-footer call-to-action cue (e.g. "Configure") shown footer-left when a card rowVariant is clickable (navigateTo); rendered as mono amber text + a sliding arrow (a navigation hint, not a button) | string |
| itemTemplate.icon | no |  | string |
| itemTemplate.iconVariant | no | leading-indicator style: avatar (solid disc + glyph, default), tile (soft-tint rounded square + glyph), dot (small status dot + halo) | `avatar` \| `tile` \| `dot` |
| itemTemplate.rowVariant | no | row layout: default (antd List.Item.Meta — avatar + stacked title/description) | tree (tight single-line mono Relations row: connector + status dot + primaryText + muted inline subPrimaryText + right-aligned colored secondaryText) | card (full antd Card tile — icon-tile + name + version badge (subPrimaryText) + category tag (secondaryText) + description + a footer of rowActions as visible buttons — the Marketplace catalog grid) | chip (compact navigable filter pill — primaryText label + optional count, solid/amber when the item's active flag is set — the data-driven Marketplace facet chips) | `default` \| `tree` \| `card` \| `chip` |
| itemTemplate.secondaryTextAsTag | no | render secondaryText as a soft-tint Tag pill (e.g. a category) instead of plain text | boolean |
| itemTemplate.subPrimaryTextMono | no | render subPrimaryText as a small mono bordered pill (e.g. an event involvedObject Kind/name ref) instead of plain sub-text | boolean |
| itemTemplate.navigateTo | no | per-item navigation target ({dot.path} template, e.g. {link}); when it resolves non-empty the row becomes clickable and navigates there (SPA route) | string |
| itemTemplate.color | no |  | object |
| itemTemplate.color.value | no |  | string |
| itemTemplate.color.map | no |  | object |
| itemTemplate.color.default | no |  | string |
| itemTemplate.status | no | an at-a-glance status indicator (a Font Awesome glyph) rendered top-right of the `card` rowVariant. Each field is a {dot.path} resolved per item; the raw-value -> glyph/colour mapping is computed server-side (jq in the RESTAction), so the widget stays strongly typed. E.g. a blueprint's CompositionDefinition Ready condition resolved to {readyIcon}/{readyColor}/{readyReason}. | object |
| itemTemplate.status.icon | no | {dot.path} to the resolved Font Awesome icon name (e.g. {readyIcon}) | string |
| itemTemplate.status.color | no | {dot.path} to the resolved palette colour (e.g. {readyColor}) | string |
| itemTemplate.status.tooltip | no | {dot.path} tooltip text shown on hover (e.g. {readyReason}) | string |
| itemTemplate.bar | no | per-row horizontal Progress bar (the reconciliation-rail row): an antd Progress line whose percent + stroke colour are resolved per item | object |
| itemTemplate.bar.percent | no | {dot.path} to a 0-100 number (e.g. {healthPercent}) | string |
| itemTemplate.bar.color | no |  | object |
| itemTemplate.bar.color.value | no |  | string |
| itemTemplate.bar.color.map | no |  | object |
| itemTemplate.bar.color.default | no |  | string |
| itemTemplate.bar.label | no | optional trailing {dot.path} label (e.g. the % text or 7/7) | string |
| itemTemplate.bar.variant | no |  | `line` \| `rail` |
| itemTemplate.formats | no |  | object |
| itemTemplate.formats.primaryText | no |  | `text` \| `datetime` \| `relative` |
| itemTemplate.formats.secondaryText | no |  | `text` \| `datetime` \| `relative` |
| itemTemplate.formats.subPrimaryText | no |  | `text` \| `datetime` \| `relative` |
| itemTemplate.formats.subSecondaryText | no |  | `text` \| `datetime` \| `relative` |
| itemTemplate.rowActions | no | per-row action controls rendered as a kebab (⋯) menu on each row; each entry references an action id from widgetData.actions and is fired with the row's data as the action payload (customPayload). Distinct from navigateTo (whole-row click). | array |
| itemTemplate.rowActions[].actionId | yes | id of an action defined in widgetData.actions to fire when this menu item is clicked | string |
| itemTemplate.rowActions[].label | yes | menu item label | string |
| itemTemplate.rowActions[].icon | no | optional Font Awesome icon name for the menu item | string |
| itemTemplate.rowActions[].danger | no | render the menu item in a destructive (red) style | boolean |
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
| actions.rest[].onEventNavigateTo.reloadRoutes | no |  | boolean |
| actions.rest[].onEventNavigateTo.loadingMessage | no | message to display while waiting for the event | string |
| actions.rest[].type | yes | type of action to execute | `rest` |
| actions.rest[].headers | yes | array of headers as strings, format 'key: value' | array |
| actions.rest[].payload | no | static payload sent with the request | object |
| actions.rest[].payloadToOverride | no | list of payload fields to override dynamically | array |
| actions.rest[].payloadToOverride[].name | yes | name of the field to override | string |
| actions.rest[].payloadToOverride[].value | yes | value to use for overriding the field | string |
| actions.rest[].loading | no |  | object |
| actions.rest[].loading.display | yes |  | boolean |
| actions.navigate | no | client-side navigation actions | array |
| actions.navigate[].id | yes | unique identifier for the action | string |
| actions.navigate[].loading | no |  | object |
| actions.navigate[].loading.display | yes |  | boolean |
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
| actions.openDrawer[].loading | no |  | object |
| actions.openDrawer[].loading.display | yes |  | boolean |
| actions.openModal | no | actions to open modal dialog components | array |
| actions.openModal[].id | yes | unique identifier for the modal action | string |
| actions.openModal[].type | yes | type of modal action | `openModal` |
| actions.openModal[].resourceRefId | yes | the identifier of the k8s custom resource that should be represented | string |
| actions.openModal[].requireConfirmation | no | whether user confirmation is required before opening | boolean |
| actions.openModal[].title | no | title shown in the modal header | string |
| actions.openModal[].loading | no |  | object |
| actions.openModal[].loading.display | yes |  | boolean |
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
| allowCopy | no | displays a copy button on top of the widget to allow copy to clipboard | boolean |
| allowDownload | no | displays a download button on top of the widget to allow download of the text | boolean |
| downloadFileExtension | no | if 'allowDownload' is set, this property allows to set an extension for the downloaded file. Default is .txt | string |
| markdown | yes | markdown string to be displayed | string |


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
| items[].type | no | set to 'divider' to render a visual separator at this order position; no path or label needed | `divider` |

---

### Paragraph

Paragraph is a simple component used to display a block of text

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| text | yes | the content of the paragraph (the antd Typography children, as text) | string |
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
| items[].resourceRefId | yes |  | string |
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
| mode | no | antd Select `mode` | `multiple` \| `tags` |
| placeholder | no | antd Select `placeholder` | string |
| size | no | antd Select `size` | `small` \| `middle` \| `large` |
| disabled | no | antd Select `disabled` | boolean |
| allowClear | no | antd Select `allowClear` | boolean |
| queryParam | no | when set, the Select is STANDALONE and URL-query-bound (not a Form.Item control): its value reads from / writes to this URL search param (e.g. 'project'), flowing to server-side `extras` like RangePicker. Omit for the default Form control behavior. | string |


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

### Statistic

Statistic highlights a single numeric value

#### Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| title | no | the statistic label | string |
| value | yes | the statistic value | integer | string |
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
| current | no | the index of the current step (0-based) | integer |
| orientation | no | the layout orientation of the steps (antd Steps `orientation`) | `horizontal` \| `vertical` |
| size | no | the size of the steps | `default` \| `small` |
| status | no | the status of the current step | `wait` \| `process` \| `finish` \| `error` |
| titlePlacement | no | where the title is placed relative to the step icon (antd Steps `titlePlacement`) | `horizontal` \| `vertical` |
| type | no | the visual type of the steps | `default` \| `navigation` \| `inline` |
| items | yes | the steps to display | array |
| items[].title | yes | the title of the step | string |
| items[].eyebrow | no | a short eyebrow label shown ABOVE the title (e.g. `Step 1`) — rendered mono/uppercase | string |
| items[].description | no | the description of the step | string |
| items[].subTitle | no | the subtitle of the step | string |
| items[].status | no | the status of this step | `wait` \| `process` \| `finish` \| `error` |
| items[].icon | no | a font awesome icon name for the step (eg: `fa-user`) | string |
| items[].resourceRefId | no | optional id of a widget to render inline below this step's description (e.g. an action button for the active step) | string |


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
| columns[].color | no | the color of the value (or the icon) to be represented | `blue` \| `darkBlue` \| `orange` \| `gray` \| `red` \| `green` \| `violet` |
| columns[].title | yes | column header label | string |
| columns[].valueKey | yes | key used to extract the value from row data | string |
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
| size | no | antd Table size. Defaults to 'middle' when omitted (matching Button), so an unset value has a documented, Brand-consistent density rather than antd's raw default | `large` \| `middle` \| `small` |
| prefix | no | it's the filters prefix to get right values | string |
| rowNavigateTo | no | optional route path to navigate to on row click; `{valueKey}` placeholders are filled from that row's cells (e.g. /compositions/{ns}/{name}) | string |
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
| label | yes | the tag text | string |
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
| custom.sidebar.bgGradientStart | no |  | string |
| custom.sidebar.bgGradientEnd | no |  | string |
| custom.menu | no | sidebar nav-item colours (→ --menuitem-color / --menuitembg-color / --krateo-nav-item*) | object |
| custom.menu.itemColor | no |  | string |
| custom.menu.itemHoverColor | no |  | string |
| custom.menu.itemSelectedBg | no |  | string |
| custom.menu.itemSelectedColor | no |  | string |

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

