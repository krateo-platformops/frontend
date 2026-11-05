//go:build baseline

package main

// The classifier, against real published artifacts.
//
// WHY NOT A FIXTURE. The whole argument for using the published history as the record is that it is
// immutable and nobody can edit it after the fact. A hand-built fixture would exercise the matching
// logic while assuming away the property the design rests on — and this repo has already paid for a
// control that only falsified what its fixture expressed.
//
// The ABSORBED case has a real example, which is the one worth testing: #612 added
// `required: [id]` to `resourcesRefsTemplate[].template` across all 44 widget CRDs, and it shipped
// in 1.8.22. So an acceptance for that tightening matches NOTHING today — the pin already carries
// it, so there is no finding — while matching the published 1.8.21 -> 1.8.22 comparison exactly.
// That is precisely the shape the old check would have called rot.

import (
	"testing"
)

func TestClassifyUnmatchedAgainstPublishedHistory(t *testing.T) {
	const pin = "1.8.22"
	prev, err := previousPublished(chartRef, pin)
	if err != nil {
		t.Fatalf("probing the version below %s: %v", pin, err)
	}
	if prev != "1.8.21" {
		t.Fatalf("expected 1.8.21 below %s, got %q — if the registry changed, the premise of this "+
			"test moved and the expectations below need re-deriving", pin, prev)
	}

	olderDir, err := pullChart(t, prev)
	if err != nil {
		t.Fatalf("pull %s: %v", prev, err)
	}
	pinDir, err := pullChart(t, pin)
	if err != nil {
		t.Fatalf("pull %s: %v", pin, err)
	}
	older := collect(t, []string{olderDir})
	pinned := collect(t, []string{pinDir})

	historical := map[string][]Tightening{}
	for key, schema := range pinned {
		if o, ok := older[key]; ok {
			if hits := Tightenings(o, schema, key); len(hits) > 0 {
				historical[key] = hits
			}
		}
	}
	if len(historical) == 0 {
		t.Fatalf("no tightening between the published %s and %s, so this test cannot distinguish "+
			"anything — the ABSORBED arm would pass vacuously", prev, pin)
	}
	t.Logf("%s -> %s carries tightenings on %d CRD version(s)", prev, pin, len(historical))

	// ABSORBED: #612's requirement, which shipped in the pin.
	shipped := &Acceptance{
		Path:       "*",
		PathSuffix: ".spec.resourcesRefsTemplate[].template",
		Clause:     "required",
	}
	if got := classifyUnmatched(shipped, historical); got != absorbed {
		t.Errorf("an acceptance for a tightening that SHIPPED in the pin must classify as "+
			"absorbed, got %v", got)
	}

	// NOT YET APPLICABLE: a clause and a path that no published version carries.
	early := &Acceptance{
		Path:       "*",
		PathSuffix: ".spec.widgetData.aFieldNobodyHasAddedYet",
		Clause:     "enum",
	}
	if got := classifyUnmatched(early, historical); got != notYetApplicable {
		t.Errorf("an acceptance for a tightening that exists nowhere must classify as not-yet-"+
			"applicable, got %v", got)
	}

	// THE DISCRIMINATION THAT MATTERS: the same path, a DIFFERENT clause. The tightening at that
	// path was a `required`, so an `enum` acceptance there is not the one that shipped — it is
	// early. Without this, a classifier keyed on path alone would call it absorbed and demand its
	// deletion, which is the old conflation wearing new clothes.
	wrongClause := &Acceptance{
		Path:       "*",
		PathSuffix: ".spec.resourcesRefsTemplate[].template",
		Clause:     "enum",
	}
	if got := classifyUnmatched(wrongClause, historical); got != notYetApplicable {
		t.Errorf("the same path with a different clause must NOT be read as the shipped "+
			"tightening, got %v", got)
	}

	// And classification must not make an entry look matched to the live check — the probe uses a
	// copy for exactly this reason.
	if shipped.Matched() != 0 {
		t.Errorf("classifying must not record a match on the entry itself, got %d",
			shipped.Matched())
	}
}

// A PROBE FAILURE MUST NOT READ AS "no earlier version".
//
// This is the arm with the worst failure mode and the least obvious one. If a registry outage
// returned "" instead of an error, every unmatched acceptance would classify as merely early and
// genuine rot would be excused — silently, on a green run. The distinction is one `if` in
// previousPublished, and without a test it is one `if` away from being refactored out.
//
// An unreachable registry gives a connection error rather than a not-found, which is exactly the
// case the distinction exists for.
func TestProbeFailureIsAnErrorNotAGap(t *testing.T) {
	// Port 1 on loopback: nothing listens, so this fails to connect rather than 404ing.
	_, err := previousPublished("oci://127.0.0.1:1/charts/nothing-here", "1.0.1")
	if err == nil {
		t.Error("an unreachable registry must be an error, not an empty predecessor — returning " +
			"\"\" would classify every unmatched acceptance as merely early and excuse real rot")
	}
}
