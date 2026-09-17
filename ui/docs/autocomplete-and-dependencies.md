---
type: Architecture
title: frontend — Form suggestions, autocomplete & dependencies
description: The `x-krateo-suggestions` schema extension (a server-computed, open option catalogue on a Form field), plus the historical note on the removed client-side autocomplete/dependencies configuration.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, archive]
timestamp: 2026-09-17T00:00:00Z
---

# `x-krateo-suggestions` — an open option catalogue on a schema field

A schema-driven Form field can offer a catalogue of known values while still accepting
anything the user types. The catalogue is a vendor extension on the JSON Schema **property**,
not a `widgetData` field:

```yaml
where:
  type: string
  title: Where
  x-krateo-suggestions:
    - value: 'SeverityText:"ERROR"'
      label: Errors
      description: any log line at ERROR severity
      group: Log severity
    - value: 'ServiceName:"snowplow"'
      group: Services
```

Each entry is `{ value, label?, description?, group? }`; a bare string is shorthand for
`{ value }`. `value` is what lands in the field, `label` is what is shown (defaults to
`value`), `description` is a muted second line, and `group` becomes an optgroup heading —
the natural place for *how* a value is produced (the receiver a metric comes from, say).
Group and entry order are preserved as authored. Malformed entries are dropped and the rest
of the field still renders: the catalogue is assembled from live data, so bad data must not
break the form.

**Why not `enum`.** `enum` is a *closed* set — it renders a Select that commits one of its
options, and JSON Schema validation rejects anything else. Suggestions are the opposite
contract: *offer, do not restrict*. The motivating case is the Alert create form, whose
`spec.where` is a free Lucene expression — the platform knows which signals it actually
collects and should offer them, but an expression nobody catalogued has to stay typeable.

**What it renders.** A scalar property becomes an antd `AutoComplete` (a text input that
suggests — free text survives); an open string `array` keeps its `mode='tags'` Select, now
seeded with the catalogue. Search matches label, value *and* description. A property that
carries both `enum` and suggestions renders as suggestions — `enum` winning there would
silently reject every hand-typed value, the exact failure this exists to prevent.

**Where the catalogue comes from.** Server-side, like all derived values: a
`widgetDataTemplate` jq expression over an `apiRef` RESTAction result grafts the entries onto
the property. No CRD change is needed — `widgetData.schema` is
`x-kubernetes-preserve-unknown-fields`, so the extension travels through the apiserver
untouched. The frontend never fetches options itself.

Implementation: `getSuggestionGroups` in `../src/widgets/Form/utils.ts`, consumed by
`controlFor` in `../src/widgets/Form/SchemaFields.tsx`.

# Form autocomplete & dependencies — removed

Earlier frontend versions documented two dynamic Form field configurations —
**`autocomplete`** (RESTAction-backed option lookup as the user types) and
**`dependencies`** (cascading selects re-queried when a parent field changes), with
`{ label, value }`-shaped options and initial values.

**The current implementation has neither.** The Form widget's schema
(`../src/widgets/Form/Form.schema.json`) declares no `autocomplete` or `dependencies`
properties, and no code under `ui/src/widgets/Form/` implements the option-lookup
protocol. Dynamic form content is achieved today by templating the form's `schema` /
`items` server-side (a `widgetDataTemplate` jq expression over an `apiRef` RESTAction
result — see [the widget concept](./docs.md) and the Form entry in the
[widgets API reference](./widgets-api-reference.md)).

Do not author new CRs against the removed properties: the generated CRDs reject unknown
`widgetData` fields. `x-krateo-suggestions` above is **not** a reintroduction of
`autocomplete`: it is a static, server-computed catalogue carried inside the schema, with no
client-side lookup protocol and no re-query on keystroke. Cascading `dependencies` remain
unimplemented.
