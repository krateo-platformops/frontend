---
type: Configuration
title: frontend — Form initial values
description: The Form widget's initialValues property — precedence over schema defaults, coercion rules, and the warning behavior for invalid values.
resource: forms.widgets.templates.krateo.io
tags: [widgets, form]
timestamp: 2026-08-07T00:00:00Z
---

# Form initial values configuration

The Form widget supports the **`initialValues`** property (see the Form entry in the
[widgets API reference](./widgets-api-reference.md)), which allows form fields to load
initial values for already compiled forms.

This property is useful when form values need to be displayed or edited after being
submitted.

> [!NOTE]
> `initialValues` should not be confused with Form field `default` values, which are
> usually defined in the JSON schema (`schema`/`stringSchema`) and represent fallback
> values. `initialValues` are explicitly provided to represent the starting state of the
> form, taking precedence over `default` values but not over user-entered values.

Initial values must be defined as children of the `initialValues` property, using a
key-value structure that mirrors the form schema paths. It is the YAML author's
responsibility to provide values matching the expected field types.

The effective initial state is a layered merge (`ui/src/widgets/Form/Form.tsx:248-258`):
**schema defaults < explicit `initialValues` < a resumed local draft < an Agentiko
draft** — so a schema `default` is always overridden by an `initialValues` entry, which
in turn yields to what the user already typed (drafts). While the form is pristine,
refetched `initialValues` are re-seeded so an idle form tracks server state; once the
user touches any field, refetched values are never applied again (user input wins —
`Form.tsx:285-292`).

The related `submitDisabledWhenPristine` flag keeps the submit button disabled until at
least one field differs from its initial value (initialValues overlaid on schema
defaults) — useful for update forms.

------------------------------------------------------------------------

## Example (YAML)

### Schema

```yaml
schema:
  type: object
  properties:
    enableMetrics:
      type: boolean
      title: Enable Metrics
      default: true
    name:
      type: string
      title: Application Name
    replicas:
      type: integer
      title: Number of Replicas
      default: 2
```

### Initial values

```yaml
initialValues:
  enableMetrics: true
  name: initial-name
  replicas: 5
```

When opening the Form:

- `enableMetrics` will be set to `true`
- `name` will display `initial-name`
- `replicas` will be set to `5` (overriding the schema default value of `2`)

For additional and expanded examples, refer to the
[Form examples YAML file](../src/examples/widgets/Form/Form.example.yaml).

------------------------------------------------------------------------

> The former **autocomplete / dependencies** dynamic-field configuration was removed from
> the Form widget together with its initial-value `{ label, value }` format — see
> [autocomplete-and-dependencies.md](./autocomplete-and-dependencies.md) for the
> historical note.
