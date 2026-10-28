# builder-publish fixture

The templates and values of the `builder-publish` chart (krateo-platformops/portal, 4cd90ac), used
by `gateExtract.test.ts` / `gateGen.test.ts` as a real lookup-gated chart.

- `expected.architecture.yaml` is the descriptor `extractArchitecture` reads out of those templates,
  names included.
- `expected.architecture-template.yaml` is the GOLDEN `templates/architecture.yaml` for the chart:
  that descriptor in the chart's own order with its states, wrapped, and the `krateo:graph` block
  compiled from it. The portal ships it as `helm/builder-publish/templates/architecture.yaml`, copied
  byte for byte; `graphCompile.test.ts` holds the compiler to it.

**There is deliberately no `Chart.yaml` here.** The org release workflow publishes every
`Chart.yaml` it finds in the repository; this fixture's copy was packaged as `builder-publish` on
the 1.6.57 tag, its push was denied, and the job died before publishing `frontend` and
`frontend-crds`. The tests need only the templates. `chartsOnlyUnderHelm.test.ts` keeps it that way.
