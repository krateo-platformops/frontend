---
type: Configuration
title: frontend — Form field configuration
description: The lists in a schema-driven Form's widgetData that configure its fields by name — autocomplete and dependencies (options from a RESTAction), displayingDependencies (show/hide), objectFields (list-row titles), suggestions, notice — what each renders, how a field is named, and the rules an options RESTAction must follow.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form, schema, blueprints]
timestamp: 2026-10-30T00:00:00Z
---

# Form field configuration

A schema-driven Form (`widgetData.stringSchema` or `widgetData.schema`) renders one control
per property. Lists beside the schema, in `widgetData`, change what a control does. Each entry
names its field:

| List | Does |
| --- | --- |
| `autocomplete` | loads a field's options from a RESTAction; typed text is kept unless `closed` |
| `dependencies` | loads a field's options from a RESTAction with another field's value; a closed list unless `closed: false` |
| `displayingDependencies` | shows a field only while another field has a value, or a given one |
| `objectFields` | which item field titles the rows of a list of objects |
| `suggestions` | a static, open catalogue — see [autocomplete-and-dependencies](./autocomplete-and-dependencies.md) |

`notice` (a string) is shown above the fields.

These are the lists of the previous frontend, with the same keys; `closed`, `minChars` and
`fallback` are new. They are typed in `Form.schema.json`, so the Form CRD declares them: the API
server rejects a malformed entry in a Form, and snowplow validates the resolved `widgetData` —
lists a `widgetDataTemplate` fills included — before it serves the widget.

Standard keywords on the schema are honoured too: `required`, `enum`, `default`, `pattern`,
`minLength`/`maxLength`, `minimum`/`maximum` (both exclusive forms), `minItems`/`maxItems`,
`format: password` / `writeOnly` (a secret field). The form checks them beside the field,
before the confirm step; the API server still validates what reaches it.

```yaml
widgetData:
  schema:
    type: object
    properties:
      region: { type: string, title: Region }
      zone: { type: string, title: Zone }
      owner: { type: string, title: Owner }
      service:
        type: object
        properties:
          type: { type: string, enum: [ClusterIP, NodePort] }
          nodePort: { type: integer }
      hosts:
        type: array
        items:
          type: object
          properties:
            host: { type: string }
            zone: { type: string }
  autocomplete:
    - { name: region, resourceRefId: regions, closed: true }
    - { name: owner, resourceRefId: users, extra: { key: q }, minChars: 2 }
  dependencies:
    - { name: zone, dependsOn: { name: region }, resourceRefId: zones, extra: { key: region } }
    - { name: hosts.zone, dependsOn: { name: region }, resourceRefId: zones, extra: { key: region } }
  displayingDependencies:
    - name: service.nodePort
      dependsOn: { name: service.type, conditionType: value, value: { type: string, stringValue: NodePort } }
  objectFields:
    - { path: hosts, displayField: host }
```

## Naming a field

`name`, `path` and `dependsOn.name` are dotted paths from the root of the form:
`service.nodePort`. A path goes through a list without an index — `hosts.zone` is the `zone` of
every `hosts` row — and a `dependsOn.name` inside the same list (`hosts.region`) reads the same
row. An entry naming no field of the schema is skipped.

## `autocomplete` and `dependencies` — options from a RESTAction

| Key | Meaning |
| --- | --- |
| `name` | the field |
| `resourceRefId` | the id of one of the Form's `resourcesRefs`: a GET of a RESTAction. Never a URL |
| `closed` | `true`: only a listed value is accepted (a Select); `false`: the list suggests and typed text is kept (an AutoComplete). Default `false` for `autocomplete`, `true` for `dependencies`, as the previous frontend rendered them |
| `extra.key` | `autocomplete`: search as the person types, sending the text under this `extras` name. `dependencies`: the `extras` name the parent's value is sent under |
| `minChars` | `autocomplete` with `extra`: the shortest text that is sent (default 2) |
| `dependsOn.name` | `dependencies`: the field the options depend on |
| `fallback` | `"manual"`: a closed field whose options cannot be had takes a typed value (see *When the source is down*) |

A field in both lists depends on the other field. An array field picks several values
(`multiple` when closed, `tags` when open).

**The RESTAction answers with the list in `status`** — the output of its `filter`:
`[{ "label": "Europe", "value": "eu", "description": "optional second line" }]`, or bare
values (`["eu", "us"]`). Anything else reads as a failed load.

**What the field does.**

- It stores the option's **value** only: the payload, drafts and Agentiko see `"eu"`. The
  Review shows a top-level option field by the label it was picked by: *Europe (eu)*.
- A dependent field makes no call while the parent is empty ("Choose Region first."), then
  calls with `extras: { region: <value> }`. When the *person* changes the parent, the field is
  cleared, and so is anything that depends on it. Initial values, a resumed draft and an
  Agentiko draft keep every value they set.
- An `autocomplete` with `extra` sends the typed text, debounced (300 ms), from `minChars`
  characters; the RESTAction filters. Without it the list loads once and is filtered in the
  browser.
- A **closed** list loaded in full is enforced: a value not in it (one that arrived from a
  draft or Agentiko, say) fails validation.
- A missing ref, or one snowplow resolved with `allowed: false`, disables the field and says
  why, with no call. A failed load says so under the field with a Retry. No toasts.

**When the source is down.** A call that has not answered after 15 s is a failed load, never an
endless "Loading…". An **open** field takes typed text whatever its source does, and says so
("The options could not be loaded. You can type the value."). A **closed** field stays closed —
an empty Select cannot be filled, so the form cannot be submitted while its source is down —
unless it sets `fallback: manual`: then a failed load, or a list loaded in full that comes
back empty, turns it into a text input (a number input for a number, tags for an array), with
Retry. That value is not checked against a list, since there is none; when the source answers
again, a value not in its list is flagged as for any closed field, and the API server still
validates what reaches it. A search that finds nothing is not a fallback case.

**Refused** (the field is disabled with the reason, nothing is called): a secret as the parent
(its value would travel in a URL, a log line and a cache key); `username`, `groups`,
`displayName`, `email`, `sub` or `uid` as an `extra.key` (the names a RESTAction reads the
caller's identity from: snowplow does not strip request extras on the RESTAction path); a
`dependsOn` naming no field; a dependency cycle. A secret field never loads options.

**Where the refs come from.** The Form lists each RESTAction in `resourcesRefs`, with the `id`
the entry's `resourceRefId` names; snowplow resolves its path and whether the caller may call
it. A blueprint form gets its lists and refs from the portal's formdef, which builds its
`widgetData`.

## Writing an options RESTAction

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

## `displayingDependencies` — show or hide a field

| Key | Meaning |
| --- | --- |
| `name` | the field |
| `dependsOn.name` | the field the condition reads |
| `dependsOn.conditionType` | `value`: shown while that field equals `value`; `notEmpty`: shown while it has a value |
| `dependsOn.value` | with `value`: the expected value, typed — `{ type: string, stringValue }`, `integer`/`integerValue`, `boolean`/`booleanValue`, `array`/`arrayValue`, `option`/`optionValue.value`, `null` |

Several entries for one field must all hold. A hidden field is not rendered: it is not
validated (`required` included), not submitted, not reviewed, not counted under "Advanced",
and a saved draft leaves it out. Its value stays in the form, so it comes back when the field
is shown again, and an edit form (a merge-patch) leaves the stored value alone. A condition the
form cannot read leaves the field visible.

This is the form's rule only: the API server does not apply it. In a blueprint, write an
`if`/`then` in its `values.schema.json` for Helm to enforce the same rule when the composition
is deployed — its error then appears on the composition's status.

## Lists of objects

An array whose `items` declare `properties` renders one card per row, titled by its
`objectFields` entry's `displayField` (an item field; a dotted path such as `subjects.name`
reaches into it), else the first required string field, else the first string field: *Hosts 2 · api.example.com*. Rows collapse to that title — a row with a
validation error opens itself — and `minItems` / `maxItems` gate removing and adding rows.

An array whose `items` are objects with **no** declared fields (`imagePullSecrets`,
`tolerations`) is edited as key/value rows per item. Values are sent as `true`/`false` or as a
number when written in canonical form (`300`, not `0300`), else as the string typed; "Edit as
JSON" gives exact control, and a list with nested objects opens as JSON.

## Implementation

`../src/widgets/Form/`: `fieldConfig.ts` writes the lists on the schema nodes they name (the
internal keys of `fieldKeys.ts`, removed from any incoming schema); `fieldOptions.ts` (the spec,
the RESTAction answer, the option registry), `useFieldOptions.ts` (the fetch),
`OptionsInput.tsx` (the control), `fieldDependencies.ts` (references, cycles, clearing),
`visibleWhen.ts`, `schemaRules.ts` (constraint rules), `FreeObjectListInput.tsx`, and
`SchemaFields.tsx`, which picks the control per node.
