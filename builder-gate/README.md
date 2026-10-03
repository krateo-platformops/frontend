---
type: McpServer
title: builder-gate — validate_draft
description: The builder gate. One MCP tool, validate_draft(builder, files), that judges an agent-authored builder draft with the portal's own lint, snowplow's jq engine and the live API server before the agent hands it back.
resource: oci://ghcr.io/krateo-platformops/charts/builder-gate
tags: [mcp, gate, builders, autopilot]
timestamp: 2026-10-03T00:00:00Z
---

# builder-gate

`validate_draft(builder, files)` answers one question before an agent hands a draft back: will
the portal take it? The answer comes from the portal's own code, snowplow's own jq engine and the
live API server, never from a second rulebook (krateo-platformops/frontend#442).

It lives in this repository and is released on this repository's tag. The image of tag `X.Y.Z`
carries `X.Y.Z`'s page lint and widget schemas, so there is no pin that can drift.

## The tool

| Argument | What |
|---|---|
| `builder` | A Builder CR name (`builders.builders.templates.krateo.io` in `BUILDERS_NAMESPACE`), e.g. `portal-builder`. The gate reads the CR and runs the plan its `draftKind` names. Each instance accepts only the Builders it was deployed for. |
| `files` | The whole draft, in the builder's own shape. For a page: the ordered array of CR objects `previewPage` receives. |

It returns `{ok, failedStep, steps: [{name, ok, problems[], notes[]}], coverage}`, the same
envelope as core-provider-agent's `validate_chart`. Steps run in order and stop at the first
failure, so a later step's silence means it has not run.

## Steps (pages)

| # | Step | What it does |
|---|---|---|
| 0 | `builder` | Reads the Builder. Refuses a `draftKind` with no plan, and refuses any declared lint the plan does not know by name. Enforces the Builder's byte cap. |
| 1 | `builder-lint` | Runs `lintPageDrafts` and `pageRootProblem` from `ui/src/components/Autopilot/pageLint.ts`, imported rather than copied. It uses the `ui/src/widgets/*/*.schema.json` schemas and the plurals from `widgetKinds.generated.ts`. |
| 2 | `references` | Every root `resourcesRefs` child resolves to the draft or an existing widget, and every `spec.apiRef` resolves to the draft or an existing RESTAction. Lookups are read-only `get` calls as the gate. |
| 3 | `jq-compile` | Compiles every RESTAction `spec.filter`, per-api `filter` and `widgetDataTemplate` expression with snowplow's gojq fork and modules (`jqcheck/`). It only compiles. |
| 4 | `live-dry-run` | POSTs every object to `…/namespaces/<sandbox>/<plural>?dryRun=All&fieldValidation=Strict` as the gate's ServiceAccount and classifies the reply as `validated`, `rejected` or `notChecked`. **`notChecked` is red.** |
| 5 | `data` | Runs each draft RESTAction as the caller, as preview will. In-cluster stages go through the cert-replay hop. An `endpointRef` stage reads its endpoint Secret as the caller, then calls the Secret's `server-url` with the Secret's own credentials (token, basic, client certificate or AWS SigV4). A non-GET stage is executed and named in the notes. jq goes through snowplow `POST /jq`. It returns item counts and a sample, with endpoint credentials redacted. A caller who cannot read the endpoint Secret is red. With no caller token, or an unreachable endpoint, the step is `notChecked`, which is red. |
| 6 | `coverage` | Informational. It names what the API server accepted. |

## What the gate's identity may do, and what the caller's may do

- **The gate's own ServiceAccount never writes.** The only request it sends with a body is
  `kube.ts` `dryRunCreate`, which hard-codes the sandbox namespace and
  `?dryRun=All&fieldValidation=Strict`. RBAC has no dry-run verb, so the chart grants a real
  `create`, narrowed to the sandbox and to widgets and RESTActions.
- **The data step runs a draft RESTAction's own stages as the caller,** non-GET ones included,
  because preview runs them too. Each non-GET stage is named in the notes (`executed POST <path> on
  <host>`). No other non-GET request is sent as the caller.
- **External stages:**
  - The host comes from the endpoint Secret's `server-url`. A draft path that is an absolute URL,
    or that contains `//`, `@`, `\` or whitespace, is refused before any request is sent.
  - The request carries only the endpoint's own credentials, never the caller's bearer.
  - Credential values are redacted from everything the gate returns.
- `test/dryRunGuard.test.ts` and `test/endpoint.test.ts` hold all of this, statically over the
  source and at run time over every request the gate makes. Part of `test/endpoint.test.ts` runs
  against a real HTTP server.

## Install

The chart, `helm/builder-gate`, deploys one gate per authoring agent from values:

```yaml
instances:
  - name: frontend-agent
    builders: [portal-builder]
```

Each instance gets the following, all named `builder-gate-<name>`:

- a ServiceAccount;
- a Role in the sandbox with `create` on `widgets.templates.krateo.io/*` and `templates.krateo.io/restactions`;
- a ClusterRole with `get` and `list` on the same kinds;
- a Role with `get` on its own Builders;
- a Deployment, a Service and a kagent `RemoteMCPServer`.

## Configure

| Env (set by the chart) | What |
|---|---|
| `GATE_BUILDERS` | The Builders this instance validates for. |
| `BUILDERS_NAMESPACE` | Where Builder CRs live (`krateo-system`). |
| `SANDBOX_NAMESPACE` | The only dry-run target (`krateo-preview`). |
| `SNOWPLOW_URL` | snowplow, for `POST /jq` as the caller. |
| `CALLER_HOP_KUBECONFIG` | The cert-replay hop's kubeconfig: its address and CA. Its user is empty. |

## Examples

`examples/pod-sizing-page.json` is a root Flex, a PieChart and a Table bound to one new
RESTAction. To run it through the gate:

```sh
cd builder-gate && npm ci && (cd jqcheck && go build -o ../bin/jqcheck .) && node build.mjs
export JQCHECK_BIN=$PWD/bin/jqcheck
# offline: the live steps are DISABLED (the CLI's --offline flag; the server has no such switch)
node dist/cli.cjs --offline --builders-dir ../ui/src/builders/fixtures --builder portal-builder --draft examples/pod-sizing-page.json
# live, as a kubeconfig identity (the dry-run stores nothing)
node dist/cli.cjs --kubeconfig ~/.kube/config --context <ctx> --builder portal-builder --draft examples/pod-sizing-page.json
```

## Develop & release

- `npm test` builds the bundle and runs the suite. The suite has one mutation per rule, the
  dry-run guard, the data step against fake servers, the MCP surface end to end, and the pins.
- `.github/workflows/builder-gate.yaml` runs the following:
  - the suite;
  - the example offline;
  - a diff of the snowplow modules against `SNOWPLOW_REF`;
  - a kind job that runs the live dry-run against a real API server as the chart's own
    ServiceAccount. It checks the four RESTAction CEL rules, an unknown field under Strict,
    that nothing is stored, and that Forbidden comes back `notChecked` and red.
- The image is built multi-arch by the shared `component-image-build` workflow, on PRs without
  pushing and on tags with pushing. Never push it from a workstation.
- `SNOWPLOW_REF` and `jqcheck/go.mod` follow the snowplow tag the installer pins.
