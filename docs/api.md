---
type: API
title: frontend — api
description: The contract frontend exposes — the 43 owned widget CRDs (widgets.templates.krateo.io/v1beta1), the shared widget spec model, and the HTTP surface the container serves.
resource: widgets.templates.krateo.io
tags: [crds, widgets, api]
timestamp: 2026-08-07T00:00:00Z
---

# API

## Owned CRDs — the widget catalog

frontend owns the **43 widget CRDs** in group `widgets.templates.krateo.io`, version
`v1beta1` — one per widget kind (Alert, Badge, BarChart, Breadcrumb, Button,
ButtonGroup, Card, Checkbox, Col, DatePicker, Descriptions, Divider, Filters, Flex,
FlowChart, Form, Image, Input, InputNumber, Layout, LineChart, **Listy**, Markdown,
Menu, Paragraph, PieChart, Progress, QRCode, Radio, RangePicker, Result, Row, Select,
Slider, Statistic, Steps, Switch, Table, Tabs, Tag, Theme, Upload, YamlViewer). The
plural is the lowercase kind (`buttons`, `flexes`, `listies`, …). The list widget's kind
is `Listy` because Kubernetes reserves `List`.

- **Shipped** as the [`frontend-crds` chart](../helm/frontend-crds/templates/)
  (`oci://ghcr.io/krateo-platformops/charts/frontend-crds`).
- **Generated** from each widget's `ui/src/widgets/<Kind>/<Kind>.schema.json` via
  krateoctl — the schema, the TypeScript types and the CRD all come from one source
  (see [release](./release.md) for the sync pipeline).
- **Per-kind reference** (every `widgetData` property, generated):
  [ui/docs/widgets-api-reference.md](../ui/docs/widgets-api-reference.md).

### The shared widget spec model

Every widget `spec` has the same five properties (full semantics:
[ui/docs/docs.md](../ui/docs/docs.md)):

| Property | Meaning |
|---|---|
| `widgetData` | The kind-specific, antd-faithful display/behavior props (validated by the CRD). |
| `widgetDataTemplate` | `forPath`/`expression` (jq) overrides computed at resolve time from `apiRef` results. |
| `apiRef` | `name`/`namespace` of a snowplow `RESTAction` feeding the templates. |
| `resourcesRefs` | `items:` — referenced widgets/resources (`id`, GVR, `name`, `namespace`, `verb`), RBAC-resolved per user. |
| `resourcesRefsTemplate` | `iterator`/`template` (jq) to populate `resourcesRefs` dynamically. |

Widgets are **resolved, not reconciled**: applying one stores inert spec; snowplow's
`GET /call` computes its `status` (widgetData + resolved refs + actions) on demand for
the requesting user. There is no frontend controller.

## HTTP surface

The container itself exposes no application API — it serves the static SPA (nginx,
`try_files` fallback on the chart's `service.port`) and reverse-proxies `/autopilot/*`
to the kagent A2A endpoint on the same origin, forwarding the caller's Bearer. With
`agentgateway.enabled` the rail calls the agent gateway directly instead and this proxy is
unused. The portal's data plane is entirely
**consumed** upstream APIs (authn `/strategies`, snowplow `/call` + `/refreshes`,
events `/events` + `/notifications`) — contracts in
[ui/docs/behavior.md](../ui/docs/behavior.md).

## Related CRDs (consumed, not owned)

`RESTAction` (`templates.krateo.io/v1`) is owned by snowplow; widgets reference it via
`apiRef` ([ui/docs/restactions.md](../ui/docs/restactions.md)). The optional provenance
feature writes `AuditRecord` CRs (`audit.krateo.io/v1alpha1`) whose CRD ships with the
portal blueprint, not with this repo.
