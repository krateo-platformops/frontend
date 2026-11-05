package main

// PRE-RELEASE DOES NOT MEAN UNPUBLISHED, and the baseline is whatever the REGISTRY serves.
//
// Raised by the core-provider session from a case their estate created: core-provider 2.13.61 is
// marked `isPrerelease=true` on GitHub — measured, not reported: `gh release view 2.13.61` returns
// true — while `helm show chart oci://.../core-provider-crds --version 2.13.61` serves it. For
// "what shipped", a pre-release whose chart is pullable is a real baseline. A resolver that walked
// GitHub releases and skipped pre-releases as not-real would step straight past it and compare
// against 2.13.60, silently widening the window it is meant to bound.
//
// WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL ONE, which is the unusual part and worth
// justifying. The risk is a future change swapping the data source, and no behavioural test on
// frontend-crds can detect it: this repo has NO pre-release among its last 40 releases, so the
// registry and the releases API would agree on every version we have and a test would pass either
// way. Taking a CI dependency on core-provider's 2.13.61 to get a real pre-release would make this
// repo's gate fail if they ever unpublish it — borrowing someone else's artifact as a fixture.
//
// So the instrument that can actually see the hazard is the source: the resolver must reach the
// registry and nothing else. If someone later has a good reason to consult the releases API, this
// test is where they will read why not.

import (
	"os"
	"strings"
	"testing"
)

func TestPreviousPublishedConsultsTheRegistryOnly(t *testing.T) {
	src, err := os.ReadFile("absorbed.go")
	if err != nil {
		t.Fatalf("reading absorbed.go: %v", err)
	}
	body := string(src)

	// Strip comments so the prose above (which names GitHub) is not mistaken for a call.
	var code strings.Builder
	for _, line := range strings.Split(body, "\n") {
		if t := strings.TrimSpace(line); strings.HasPrefix(t, "//") {
			continue
		}
		code.WriteString(line)
		code.WriteString("\n")
	}

	for _, forbidden := range []string{
		"api.github.com", "gh release", "releases/latest", "/releases", "go-github",
	} {
		if strings.Contains(code.String(), forbidden) {
			t.Errorf("the baseline resolver must not consult %q: a pre-release whose chart is "+
				"published is a real baseline (core-provider 2.13.61 is exactly that), and a "+
				"releases-API walk that skips pre-releases would step past it and silently widen "+
				"the comparison window", forbidden)
		}
	}
	if !strings.Contains(code.String(), `"helm"`) {
		t.Error("the resolver no longer invokes helm, so it is not asking the registry — which is " +
			"the only source that answers 'what is published' rather than 'what was released'")
	}
}
