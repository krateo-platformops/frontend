module github.com/krateo-platformops/frontend/builder-gate/jqcheck

go 1.24.0

require github.com/itchyny/gojq v0.12.17

require github.com/itchyny/timefmt-go v0.1.8 // indirect

// snowplow evaluates every RESTAction and widget expression with this fork (snowplow go.mod,
// `replace github.com/itchyny/gojq => github.com/krateo-platformops/gojq v0.13.0`), so the gate
// compiles with it too. Keep it equal to the snowplow tag named in ../SNOWPLOW_REF.
replace github.com/itchyny/gojq => github.com/krateo-platformops/gojq v0.13.0
