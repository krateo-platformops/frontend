---
type: Configuration
title: frontend — Form schema extensions
description: The keys a schema-driven Form reads on its fields — autocomplete (options from a RESTAction), dependsOn, displayDependency (show/hide), objectField (list-row titles), suggestions, the schema notice — what each renders, where the schema has to come from for them to survive, and the rules an options RESTAction must follow.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, blueprints]
timestamp: 2026-10-29T00:00:00Z
---

# Form schema extensions

A schema-driven Form (`widgetData.stringSchema` or `widgetData.schema`) renders one control
per property. These keys, written on a property of the schema — in a blueprint, on its
`values.schema.json` — change what that control does. They carry the names of the previous
frontend's `widgetData` arrays (`autocomplete`, `dependencies`, `displayingDependencies`,
`objectFields`), moved onto the field they configure:

| Key | On | Does |
| --- | --- | --- |
| `autocomplete` | a field | loads its options from a RESTAction: a list or an autocomplete |
| `dependsOn` | a field with `autocomplete` | its options depend on another field |
| `displayDependency` | a field | shows it only while another field has a given value |
| `objectField` | an array of objects | `displayField`: which item field titles each row |
| `suggestions` | a field | a static, open catalogue — see [autocomplete-and-dependencies](./autocomplete-and-dependencies.md) |
| `notice` | the schema root | a note shown above the fields |

None of them is a JSON Schema keyword, so Helm, which validates a blueprint's
`values.schema.json`, ignores them. That is why the previous `dependencies` is not a key
here: JSON Schema defines it, and Helm rejects a chart that uses it on a field.

Standard keywords are honoured too: `required`, `enum`, `default`, `pattern`,
`minLength`/`maxLength`, `minimum`/`maximum` (both exclusive forms), `minItems`/`maxItems`,
`format: password` / `writeOnly` (a secret field). The form checks them beside the field,
before the confirm step; the API server still validates what reaches it.

## Where the schema must come from

The extensions live on the schema, so they survive only where the schema is carried as the
author wrote it:

- **Blueprint forms** read the blueprint's `values.schema.json` from the ConfigMap
  core-provider writes for each CompositionDefinition version
  (`<resource>-<version>-jsonschema-configmap`, a byte copy of the chart's file). The portal's
  `blueprint-formdef` (create) and `composition-editdef` (edit) build the Form from it.
- **The generated CRD drops them.** core-provider builds the composition CRD with
  plumbing's crdgen, which keeps only the keywords it models: these keys, `if`/`then` and
  `const` are removed, without an error. When the ConfigMap is missing, the create form falls
  back to the CRD schema and says so with `notice`.
- **Hand-written Forms** can write the keys directly in `widgetData.schema` (the CRD
  types it `x-kubernetes-preserve-unknown-fields`) or `stringSchema`.

## `autocomplete` and `dependsOn` — options from a RESTAction

```json
"region": { "type": "string", "title": "Region",
  "autocomplete": { "resourceRefId": "regions", "closed": true } },

"zone": { "type": "string", "title": "Zone",
  "autocomplete": { "resourceRefId": "zones", "closed": true },
  "dependsOn": { "name": "region", "extra": { "key": "region" } } },

"owner": { "type": "string", "title": "Owner",
  "autocomplete": { "resourceRefId": "users", "extra": { "key": "q" }, "minChars": 2 } }
```

| Key | Meaning |
| --- | --- |
| `autocomplete.resourceRefId` | the id of one of the Form's `resourcesRefs`: a GET of a RESTAction. Never a URL |
| `autocomplete.closed` | `true`: only a listed value is accepted (a Select). Default `false`: the list suggests and typed text is kept (an AutoComplete) |
| `autocomplete.extra.key` | search as the person types: the `extras` name the typed text is sent under |
| `autocomplete.minChars` | with `extra`: the shortest text that is sent (default 2) |
| `autocomplete.fallback` | `"manual"`: a closed field whose options cannot be had takes a typed value (see *When the source is down*) |
| `dependsOn.name` | the field the options depend on (see *Field references*) |
| `dependsOn.extra.key` | the `extras` name the parent's value is sent under |

`dependsOn` sits on the field beside `autocomplete`, whose RESTAction it feeds; on a field
with no `autocomplete` it disables the field and says why.

An array field picks several values (`multiple` when closed, `tags` when open).

**The RESTAction answers with the list in `status`** — the output of its `filter`:
`[{ "label": "Europe", "value": "eu", "description": "optional second line" }]`, or bare
values (`["eu", "us"]`). Anything else reads as a failed load.

**What the field does.**

- It stores the option's **value** only: the payload, drafts and Autopilot see `"eu"`. The
  Review shows a top-level option field by the label it was picked by: *Europe (eu)*.
- With `dependsOn` it makes no call while the parent is empty ("Choose Region first."), then
  calls with `extras: { region: <value> }`. When the *person* changes the parent, the field is
  cleared, and so is anything that depends on it. Initial values, a resumed draft and an
  Autopilot draft keep every value they set.
- With `extra` it sends the typed text, debounced (300 ms), from `minChars` characters; the
  RESTAction filters. Without it the list loads once and is filtered in the browser.
- A **closed** list loaded in full is enforced: a value not in it (one that arrived from a
  draft or Autopilot, say) fails validation.
- A missing ref, or one snowplow resolved with `allowed: false`, disables the field and says
  why, with no call. A failed load says so under the field with a Retry. No toasts.

**When the source is down.** A call that has not answered after 15 s is a failed load, never an
endless "Loading…". An **open** field takes typed text whatever its source does, and says so
("The options could not be loaded. You can type the value."). A **closed** field stays closed —
an empty Select cannot be filled, so the form cannot be submitted while its source is down —
unless it sets `"fallback": "manual"`: then a failed load, or a list loaded in full that comes
back empty, turns it into a text input (a number input for a number, tags for an array), with
Retry. That value is not checked against a list, since there is none; when the source answers
again, a value not in its list is flagged as for any closed field, and the API server still
validates what reaches it. A search that finds nothing is not a fallback case.

**Refused** (the field is disabled with the reason, nothing is called): a secret as the parent
(its value would travel in a URL, a log line and a cache key); `username`, `groups`,
`displayName`, `email`, `sub` or `uid` as an `extra.key` (the names a RESTAction reads the caller's
identity from: snowplow does not strip request extras on the RESTAction path); a `dependsOn`
cycle; `autocomplete.extra.key` equal to `dependsOn.extra.key`; a `fallback` other than
`"manual"`; a `dependsOn` with no `autocomplete`. A secret field never loads options.

### Where the refs come from

- **Blueprint forms:** `blueprint-formdef` and `composition-editdef` collect every
  `autocomplete.resourceRefId` of the schema, and the Form turns each into a GET
  `resourcesRefs` entry. A bare id (`"regions"`) names a RESTAction **in the blueprint's own namespace**,
  applied together with its CompositionDefinition; `"<namespace>/<name>"` names a shared one —
  the portal ships `form-options-namespaces` in its release namespace. snowplow resolves each
  ref's path and whether the caller may call it.
- **Hand-written Forms** list the RESTAction in `resourcesRefs` themselves, with the `id` the
  field's `resourceRefId` names.

### Writing an options RESTAction

```yaml
apiVersion: templates.krateo.io/v1
kind: RESTAction
metadata:
  name: zones
  namespace: my-blueprints        # the blueprint's namespace
  annotations:
    krateo.io/form-options: "true"
spec:
  api:
    - name: zones
      dependsOn:
        name: ""
        # no region, no call — the gate the portal's lint-ra-paths enforces
        iterator: '[ { region: (.region // "") } | select(.region != "") ]'
      path: ${ "/apis/example.io/v1/zones?labelSelector=region%3D" + (.region | @uri) }
      verb: GET
      filter: '[.zones.items[]? | {label: .spec.displayName, value: .metadata.name}]'
  filter: '[(.zones // [])[]]'
```

- **Escape every typed value with `@uri`.** `extras` arrive as top-level keys, and a path is a
  request to the API server as the caller: an unescaped `default/secrets/x?` is a different
  request.
- **Never read Secrets.** Whatever a step fetches lands in snowplow's cache and, through the
  filter, in a dropdown.
- **Answer with a list**, and leave out `continueOnError` where a 403 should read as "could not
  be loaded" rather than as an empty list.
- Each distinct value creates its own snowplow cache cell: keep `minChars` meaningful.

The portal's `scripts/lint-form-options.py` checks the first three on every RESTAction
annotated `krateo.io/form-options: "true"`.

## `displayDependency` — show or hide a field

```json
"type": { "type": "string", "enum": ["ClusterIP", "NodePort"] },
"nodePort": { "type": "integer",
  "displayDependency": { "dependsOn": { "name": "type" }, "conditionType": "value", "value": "NodePort" } }
```

A condition is `{ dependsOn: { name }, conditionType, value | values }`, as in the previous
frontend's `displayingDependencies`: `conditionType` is `value` (the field equals `value` — any
JSON value, not the typed `stringValue`/`integerValue` the CRD-bound version needed), `in` (it
is one of `values`) or `notEmpty`. A list of conditions holds when every one does. A hidden field is not rendered: it is not validated (`required`
included), not submitted, not reviewed, not counted under "Advanced", and a saved draft leaves
it out. Its value stays in the form, so it comes back when the field is shown again, and an
edit form (a merge-patch) leaves the stored value alone. A rule the form cannot read leaves
the field visible.

This is the form's rule only: the API server does not apply it, nor an `if`/`then` (the CRD
has neither). Write an `if`/`then` beside it for Helm to enforce the same rule when the
composition is deployed — its error then appears on the composition's status.

## Field references

`dependsOn.name` (on a field, and inside a `displayDependency` condition) names another field **relative to the
object holding the field**: `"region"` is a sibling, `"network.region"` a sibling's child,
and inside a list row both are in the same row. A leading `/` starts at the root of the form:
`"/spec.region"`.

## Lists of objects

An array whose `items` declare `properties` renders one card per row, titled by
`objectField.displayField` (the name of an item field), else the first required string field, else
the first string field: *Hosts 2 · api.example.com*. Rows collapse to that title — a row with a
validation error opens itself — and `minItems` / `maxItems` gate removing and adding rows.

An array whose `items` are objects with **no** declared fields (`imagePullSecrets`,
`tolerations`) is edited as key/value rows per item. Values are sent as `true`/`false` or as a
number when written in canonical form (`300`, not `0300`), else as the string typed; "Edit as
JSON" gives exact control, and a list with nested objects opens as JSON.

## Implementation

`../src/widgets/Form/`: `fieldOptions.ts` (the spec, the RESTAction answer, the option
registry), `useFieldOptions.ts` (the fetch), `OptionsInput.tsx` (the control),
`fieldDependencies.ts` (references, cycles, clearing), `visibleWhen.ts`, `schemaRules.ts`
(constraint rules), `FreeObjectListInput.tsx`, and `SchemaFields.tsx`, which picks the control
per node.
