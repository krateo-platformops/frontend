---
type: Configuration
title: frontend — Form schema extensions
description: The x-krateo-* keywords a schema-driven Form reads on its fields — options loaded from a RESTAction (autocomplete, dependent fields), show/hide, list-row titles, the schema notice — what each renders, where the schema has to come from for them to survive, and the rules an options RESTAction must follow.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, blueprints]
timestamp: 2026-10-27T00:00:00Z
---

# Form schema extensions

A schema-driven Form (`widgetData.stringSchema` or `widgetData.schema`) renders one control
per property. These vendor keywords, written on a property of the schema — in a blueprint, on
its `values.schema.json` — change what that control does:

| Keyword | On | Does |
| --- | --- | --- |
| `x-krateo-options` | a field | loads its options from a RESTAction: a list, an autocomplete, a field that depends on another |
| `x-krateo-visible-when` | a field | shows it only while another field has a given value |
| `x-krateo-row-title` | an array of objects | which item field titles each row |
| `x-krateo-suggestions` | a field | a static, open catalogue — see [autocomplete-and-dependencies](./autocomplete-and-dependencies.md) |
| `x-krateo-notice` | the schema root | a note shown above the fields |

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
  plumbing's crdgen, which keeps only the keywords it models: every `x-krateo-*`, `if`/`then`
  and `const` is removed, without an error. When the ConfigMap is missing, the create form
  falls back to the CRD schema and says so with `x-krateo-notice`.
- **Hand-written Forms** can write the extensions directly in `widgetData.schema` (the CRD
  types it `x-kubernetes-preserve-unknown-fields`) or `stringSchema`.

## `x-krateo-options` — options from a RESTAction

```json
"region": { "type": "string", "title": "Region",
  "x-krateo-options": { "ref": "regions", "closed": true } },

"zone": { "type": "string", "title": "Zone",
  "x-krateo-options": { "ref": "zones", "closed": true,
    "dependsOn": { "field": "region", "param": "region" } } },

"owner": { "type": "string", "title": "Owner",
  "x-krateo-options": { "ref": "users", "search": { "param": "q", "minChars": 2 } } }
```

| Key | Meaning |
| --- | --- |
| `ref` | the id of one of the Form's `resourcesRefs`: a GET of a RESTAction. Never a URL |
| `closed` | `true`: only a listed value is accepted (a Select). Default `false`: the list suggests and typed text is kept (an AutoComplete) |
| `dependsOn.field` | the field the options depend on (see *Field references*) |
| `dependsOn.param` | the `extras` name the parent's value is sent under |
| `search.param` | the `extras` name the typed text is sent under |
| `search.minChars` | the shortest text that is sent (default 2) |

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
- With `search` it sends the typed text, debounced (300 ms), from `minChars` characters; the
  RESTAction filters. Without it the list loads once and is filtered in the browser.
- A **closed** list loaded in full is enforced: a value not in it (one that arrived from a
  draft or Autopilot, say) fails validation.
- A missing ref, or one snowplow resolved with `allowed: false`, disables the field and says
  why, with no call. A failed load says so under the field with a Retry. No toasts.

**Refused** (the field is disabled with the reason, nothing is called): a secret as the parent
(its value would travel in a URL, a log line and a cache key); `username`, `groups`,
`displayName`, `email`, `sub` or `uid` as a `param` (the names a RESTAction reads the caller's
identity from: snowplow does not strip request extras on the RESTAction path); a `dependsOn`
cycle; `search.param` equal to `dependsOn.param`. A secret field never loads options.

### Where the refs come from

- **Blueprint forms:** `blueprint-formdef` and `composition-editdef` collect every
  `x-krateo-options.ref` of the schema, and the Form turns each into a GET `resourcesRefs`
  entry. A bare `ref` (`"regions"`) names a RESTAction **in the blueprint's own namespace**,
  applied together with its CompositionDefinition; `"<namespace>/<name>"` names a shared one —
  the portal ships `form-options-namespaces` in its release namespace. snowplow resolves each
  ref's path and whether the caller may call it.
- **Hand-written Forms** list the RESTAction in `resourcesRefs` themselves, with the `id` the
  field's `ref` names.

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

## `x-krateo-visible-when` — show or hide a field

```json
"type": { "type": "string", "enum": ["ClusterIP", "NodePort"] },
"nodePort": { "type": "integer",
  "x-krateo-visible-when": { "field": "type", "equals": "NodePort" } }
```

A rule is `{ field, equals }`, `{ field, in: [...] }`, `{ field, notEmpty: true }`, or
`{ all: [ ...rules ] }`. A hidden field is not rendered: it is not validated (`required`
included), not submitted, not reviewed, not counted under "Advanced", and a saved draft leaves
it out. Its value stays in the form, so it comes back when the field is shown again, and an
edit form (a merge-patch) leaves the stored value alone. A rule the form cannot read leaves
the field visible.

This is the form's rule only: the API server does not apply it, nor an `if`/`then` (the CRD
has neither). Write an `if`/`then` beside it for Helm to enforce the same rule when the
composition is deployed — its error then appears on the composition's status.

## Field references

`dependsOn.field` and `x-krateo-visible-when.field` name another field **relative to the
object holding the field**: `"region"` is a sibling, `"network.region"` a sibling's child,
and inside a list row both are in the same row. A leading `/` starts at the root of the form:
`"/spec.region"`.

## Lists of objects

An array whose `items` declare `properties` renders one card per row, titled by
`x-krateo-row-title` (the name of an item field), else the first required string field, else
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
