---
type: McpServer
title: builder-gate — validate_draft
description: The builder gate. One MCP tool, validate_draft(builder, files), that judges an agent-authored builder draft with the portal's own lint, snowplow's jq engine and the live API server (through snowplow, as the caller) before the agent hands it back.
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

The gate is thin. Steps 0–3 are static. Everything that needs the live cluster goes through
snowplow as the caller ([docs/snowplow-contract.md](docs/snowplow-contract.md)). The gate holds no
RBAC beyond reading its own Builder and emulates nothing snowplow does.

| # | Step | What it does |
|---|---|---|
| 0 | `builder` | Reads the Builder, as the gate's ServiceAccount (its only grant). Refuses a `draftKind` with no plan, and refuses any declared lint the plan does not know by name. Enforces the Builder's byte cap. |
| 1 | `builder-lint` | Runs `lintPageDrafts` and `pageRootProblem` from `ui/src/components/Autopilot/pageLint.ts`, imported rather than copied, with the `ui/src/widgets/*/*.schema.json` schemas and the plurals from `widgetKinds.generated.ts`. Adds **the portal's secrets rule** (`src/pages/secrets.ts`, ported function for function from portal `scripts/lint-ra-secrets.py` at the commit in `test/secrets/PORTAL_REF`). No RESTAction step may name Secrets, however encoded. No path may climb with `..` or `%2e`. A data-driven or character-building `${ }` path passes only as `${ .<field> }`, behind an iterator that begins with `portal.fetchableDefs` verbatim and applies `(.<field> \| fetchablePath)`. |
| 2 | `references` | Checks every widget's `resourcesRefs` items, every literal `resourcesRefsTemplate` entry and every `spec.apiRef`. Each must resolve to the draft, or to an object snowplow reads **raw** (stored, not resolved) as the caller. An existing RESTAction the page binds is held to the secrets rule too. |
| 3 | `jq-compile` | Compiles every RESTAction `spec.filter`, per-api `filter` and `widgetDataTemplate` expression with snowplow's gojq fork and modules (`jqcheck/`). It only compiles. |
| 4 | `live-dry-run` | Sends every object to snowplow `POST /call/dry-run?…&dryRun=All&fieldValidation=Strict` as the caller. Classifies an echoed reply as `validated`, `rejected` or `notChecked`; an unechoed reply is `notChecked`. |
| 5 | `data` | Asks snowplow to resolve each draft RESTAction inline (`POST /call/read`, the draft in the body), as the caller, persisting nothing. Reports per-stage errors (a write-verb stage not run by design is a note, only with its reason code). Reports a count and a short sample, with anything Secret-shaped dropped first. |
| 6 | `coverage` | Informational. It names what the API server accepted. |

**What is red:**

- `notChecked`: no caller token, unreachable, a timeout, or a reply without its echo header.
- `live verdict missing`: a snowplow that has not advertised the call a step needs. That is every
  snowplow before 1.12.36, which ships the contract (snowplow#443,
  [docs/snowplow-contract.md](docs/snowplow-contract.md)).

There is no green without the API server's judgement (#442 D9).

## Nothing the gate sends stores anything

- **The gate's own identity:** sends only `GET`, and only for its Builder (`kube.ts`).
- **Every POST** is in `snowplow.ts`, and there are exactly two:
  - the dry-run, to `/call/dry-run` ONLY, whose URL ends in the constant
    `dryRun=All&fieldValidation=Strict`. An older snowplow does not serve that route, so it answers
    404 and writes nothing. The gate never writes to plain `/call`, which an older snowplow would
    treat as a real create.
  - the inline resolve, `POST /call/read`, a read route.
- **Each POST is sent only when snowplow advertises its capability token.**
- **A reply without its echo is never a pass.** The echoes are `X-Snowplow-Dry-Run`,
  `X-Snowplow-Field-Validation`, `X-Snowplow-Resolve-Source` and `X-Snowplow-Raw`.
- `test/dryRunGuard.test.ts` holds this statically over the source, and at run time against a
  snowplow that offers the contract and against an older one.

## Install

The chart, `helm/builder-gate`, deploys one gate per authoring agent from values:

```yaml
instances:
  - name: frontend-agent
    builders: [portal-builder]
```

Each instance, named `builder-gate-<name>`, gets:

- a ServiceAccount whose **only** grant is a Role with `get` on its own Builders, by
  `resourceNames`;
- a Deployment and a Service;
- a kagent `RemoteMCPServer`.

## Configure

| Env (set by the chart) | What |
|---|---|
| `GATE_BUILDERS` | The Builders this instance validates for. |
| `BUILDERS_NAMESPACE` | Where Builder CRs live (`krateo-system`). |
| `SANDBOX_NAMESPACE` | The only namespace a dry-run or an inline resolve names (`krateo-preview`). |
| `SNOWPLOW_URL` | snowplow, which the gate calls as the caller. |

## Examples

`examples/pod-sizing-page.json` is a root Flex, a PieChart and a Table bound to one new
RESTAction. To run it through the gate:

```sh
cd builder-gate && npm ci && (cd jqcheck && go build -o ../bin/jqcheck .) && node build.mjs
export JQCHECK_BIN=$PWD/bin/jqcheck
# offline: the live steps are DISABLED (the CLI's --offline flag; the server has no such switch)
node dist/cli.cjs --offline --builders-dir ../ui/src/builders/fixtures --builder portal-builder --draft examples/pod-sizing-page.json
# live: the kubeconfig identity reads the Builder; references, the dry-run and data go through
# snowplow as the owner of the caller token (red, "live verdict missing", until snowplow offers them)
SNOWPLOW_URL=http://<snowplow> node dist/cli.cjs --kubeconfig ~/.kube/config --context <ctx> \
  --caller-token-file <jwt-file> --builder portal-builder --draft examples/pod-sizing-page.json
```

## Develop & release

- `npm test` builds the bundle and runs the suite. It covers:
  - one mutation per rule;
  - the secrets-rule corpus (`test/secrets/cases.json`);
  - references, the dry-run and data against an in-memory snowplow that speaks the contract;
  - the never-stores guard;
  - the MCP surface end to end;
  - the pins.
- `.github/workflows/builder-gate.yaml` runs:
  - the suite;
  - the example, offline;
  - the secrets corpus through **the portal's own** `lint-ra-secrets.py` at
    `test/secrets/PORTAL_REF`;
  - a diff of the snowplow modules against `SNOWPLOW_REF`;
  - a kind job, against a real API server as the chart's own ServiceAccount. It proves the gate
    reads its own Builder and no other, may not create, get or list widgets, RESTActions or
    Secrets, and is red with no caller token.
- The image is built multi-arch by the shared `component-image-build` workflow, on PRs without
  pushing and on tags with pushing. Never push it from a workstation.
- `SNOWPLOW_REF` and `jqcheck/go.mod` follow the snowplow tag the installer pins.
