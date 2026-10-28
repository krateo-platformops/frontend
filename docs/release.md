---
type: Runbook
title: frontend — release
description: How a release ships — one plain-semver tag drives the image build, both OCI chart publishes and the widget-CRD sync; what lands where and the crds-subchart seam to watch.
resource: oci://ghcr.io/krateo-platformops/charts/frontend
tags: [release, ci, oci]
timestamp: 2026-08-07T00:00:00Z
---

# Release

One tag ships everything. This monorepo has a single version line: the app image, the
`frontend` chart and the `frontend-crds` chart all release at the tag's version.

## The runbook

1. **Merge to `main`** with PR CI green:
   [`release-pullrequest.yaml`](../.github/workflows/release-pullrequest.yaml)
   (validate-only multi-arch image build via the shared `component-image-build`, the
   docs lint, and a CRD-generation job), [`lint.yaml`](../.github/workflows/lint.yaml)
   (helm lint + schema validity + render smoke for both charts),
   [`values-schema-drift.yaml`](../.github/workflows/values-schema-drift.yaml) (the
   `config` block schema guard) and
   [`security.yml`](../.github/workflows/security.yml).
2. **Tag with plain semver — `X.Y.Z`, no `v` prefix.** All release workflows trigger on
   `[0-9]+.[0-9]+.[0-9]+` only; a `v`-prefixed tag ships **nothing**, silently.

   ```sh
   git tag 1.4.4 && git push origin 1.4.4
   ```

3. **CI builds and publishes**, no manual steps:
   - [`release-tag.yaml`](../.github/workflows/release-tag.yaml) `build` → the shared
     `component-image-build` workflow (`krateo-platformops/.github`) builds the
     multi-arch (amd64+arm64) image from `ui/` →
     `ghcr.io/krateo-platformops/frontend:X.Y.Z`.
   - [`release-oci.yaml`](../.github/workflows/release-oci.yaml) (the canonical,
     byte-identical org workflow) discovers every first-class chart under `helm/`,
     substitutes the `Chart.yaml` placeholders (`CHART_VERSION` → the tag;
     `APP_VERSION` → the latest app semver tag, which in this monorepo is the same
     tag), packages, and pushes →
     `oci://ghcr.io/krateo-platformops/charts/frontend:X.Y.Z` and
     `oci://ghcr.io/krateo-platformops/charts/frontend-crds:X.Y.Z`.
   - The same `build` job builds the builder gate from the repository root
     (`builder-gate/Dockerfile`) → `ghcr.io/krateo-platformops/builder-gate:X.Y.Z`, and
     `release-oci` publishes its chart → `oci://ghcr.io/krateo-platformops/charts/builder-gate:X.Y.Z`.
     The gate imports this tag's page lint and widget schemas, so it never pins another release
     ([builder-gate/README.md](../builder-gate/README.md)).
   - [`release-tag.yaml`](../.github/workflows/release-tag.yaml) `crds` → regenerates
     the widget CRDs from the schemas (`npm ci && npm run generate-crds` in `ui/`, via
     the pinned krateoctl), uploads them as the `frontend-crds-yaml-files` artifact,
     and — gated on the `PAT` repo secret — pushes a `krateoctl-<tag>` branch and opens
     an auto-PR syncing them. Without `PAT` the release does **not** fail: the step
     skips with a run-summary warning and the manual copy command.

4. **Verify** the artifacts pair up:

   ```sh
   helm show chart oci://ghcr.io/krateo-platformops/charts/frontend --version X.Y.Z
   # appVersion in the output must equal X.Y.Z
   ```

5. **Merge the CRD sync PR** (see the seam below), then **roll out** by bumping the
   Krateo installer's frontend chart pin (both charts move together), or `helm upgrade`
   on a standalone install ([usage](./usage.md)).

## The CRD-sync seam (know this before merging the auto-PR)

The `crds` job predates the monorepo fold: it still targets a **`crds-subchart/`**
directory (its former cross-repo layout — the "target repo" it pushes to is now this
same repo), while the chart that actually ships is
[`helm/frontend-crds/`](../helm/frontend-crds/). Until the job is repointed, an auto
sync PR (e.g. #92 for tag 1.4.3) recreates `crds-subchart/` instead of updating
`helm/frontend-crds/templates/` — **reconcile the generated CRDs into
`helm/frontend-crds/templates/` when merging**, and don't let a stray `crds-subchart/`
land (release-oci would publish it as a third chart). The CRDs are published *without*
`helm.sh/resource-policy: keep` on purpose (teardown completeness — the workflow
comments document why); do not re-add `keep`.

The `PAT` secret is a fine-grained token with Contents + Pull-requests write on this
repo; when it expires the `crds` job skips (not fails) with a warning telling you to
re-provision it (`gh secret set PAT --repo krateo-platformops/frontend`).

## CRD changes

Widget CRDs are generated from `ui/src/widgets/<Kind>/<Kind>.schema.json`. If you change
a schema, regenerate types (`npm run generate-types`) and make sure the release's CRD
sync lands in `helm/frontend-crds/templates/` in lockstep — a schema (image) / CRD
(chart) mismatch surfaces as `Unknown widget kind` or apply-time validation failures
(see [ui/docs/gotchas.md](../ui/docs/gotchas.md)).

## Docs

`docs/llms.txt` pins this bundle to the release tag — update the pin (and
[log](./log.md), when the release is notable) as part of the release PR.
