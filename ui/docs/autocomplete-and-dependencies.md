---
type: Architecture
title: frontend — Form suggestions, autocomplete & dependencies
description: The `suggestions` list of a schema-driven Form (a static or server-computed, open option catalogue on a field), plus the history of the widgetData autocomplete/dependencies configuration, which is back in its previous format.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, archive]
timestamp: 2026-10-30T00:00:00Z
---

# `suggestions` — an open option catalogue on a field

A schema-driven Form field can offer a catalogue of known values while still accepting
anything the user types. The catalogue is an entry of `widgetData.suggestions`, naming its
field as the other field lists do (see [form-schema-extensions](./form-schema-extensions.md)):

```yaml
suggestions:
  - name: where
    options:
      - value: 'SeverityText:"ERROR"'
        label: Errors
        description: any log line at ERROR severity
        group: Log severity
      - value: 'ServiceName:"snowplow"'
        group: Services
```

Each option is `{ value, label?, description?, group? }`. `value` is what lands in the field,
`label` is what is shown (defaults to `value`), `description` is a muted second line, and
`group` becomes an optgroup heading — the natural place for *how* a value is produced (the
receiver a metric comes from, say). Group and option order are preserved as authored. An
option without a usable `value` is dropped and the rest of the field still renders: the
catalogue may be assembled from live data, so bad data must not break the form.

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

**Where a live catalogue comes from.** Server-side, like all derived values: a
`widgetDataTemplate` jq expression over an `apiRef` RESTAction result fills
`widgetData.suggestions`. snowplow validates the result against the Form CRD before it serves
the widget. The frontend never fetches the catalogue itself.

Implementation: `getSuggestionGroups` in `../src/widgets/Form/utils.ts`, consumed by
`controlFor` in `../src/widgets/Form/SchemaFields.tsx`; `fieldConfig.ts` writes the list on its
field.

# Form autocomplete & dependencies — history

The previous frontend configured dynamic Form fields in `widgetData`, beside the schema, keyed
by field name: **`autocomplete`** (RESTAction-backed options as the user types),
**`dependencies`** (options re-queried when a parent field changes), later
**`displayingDependencies`** (show/hide) and **`objectFields`** (lists of objects).

For a while these behaviours were keywords on the schema field itself (`x-krateo-options`,
`x-krateo-visible-when`, `x-krateo-row-title`, `x-krateo-suggestions`, `x-krateo-notice`). The
Form CRD could not type them — `widgetData.schema` is free-form — so neither the API server nor
snowplow checked them. They are gone: the lists are back in `widgetData`, in their previous
format, typed in `Form.schema.json` and validated with the rest of the widget. The form no
longer reads those keywords. What changed from the previous frontend: a field stores the
option's value, not a `{ label, value }` pair, and `autocomplete`/`dependencies` gained
`closed`, `minChars` and `fallback`.
