---
type: Architecture
title: frontend — Form suggestions, autocomplete & dependencies
description: The `suggestion` schema key (a server-computed, open option catalogue on a Form field), plus where the earlier widgetData autocomplete/dependencies configuration went (schema extensions).
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, archive]
timestamp: 2026-10-27T00:00:00Z
---

# `suggestion` — an open option catalogue on a schema field

A schema-driven Form field can offer a catalogue of known values while still accepting
anything the user types. The catalogue is a key on the JSON Schema **property**,
not a `widgetData` field:

```yaml
where:
  type: string
  title: Where
  suggestion:
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

# Form autocomplete & dependencies — back, as schema extensions

Earlier frontend versions configured two dynamic Form field behaviours in `widgetData`:
**`autocomplete`** (RESTAction-backed option lookup as the user types) and
**`dependencies`** (cascading selects re-queried when a parent field changes), keyed by field
name, with `{ label, value }`-shaped values; later also `displayingDependencies` (show/hide)
and `objectFields` (lists of objects).

Those `widgetData` keys are **not** supported: the Form CRD declares none of them and rejects
(or prunes) unknown `widgetData` fields. The behaviours are back as keywords on the schema
field itself, with the old names — `autocomplete` (with `extra` for search), `dependsOn`,
`displayDependency`, `objectField` — documented in [form-schema-extensions](./form-schema-extensions.md).
They moved onto the field because one Form serves every blueprint: only the blueprint's own
`values.schema.json` can say which of its fields load options. Fields now store the option's
value, not a `{ label, value }` pair.
