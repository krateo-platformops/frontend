package main

// The acceptance mechanism's own tests.
//
// THIS IS THE FILE THAT MATTERS MOST in the tightening gate, and it is counter-intuitive why. The
// comparison failing open costs one missed narrowing. The ACCEPTANCE failing open costs every
// narrowing, silently, while the gate reports green and a reviewer sees "covered by a reviewed
// acceptance" — which reads like diligence. A mute button that looks like a decision is worse than
// no gate, because it also removes the pressure to build one.
//
// So each of the three properties that stop it being a mute button is pinned here: an entry covers
// ONE clause at ONE place, an entry without evidence is not loadable, and a bare wildcard cannot
// accept everything.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "accepted-tightenings.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// QUOTED in the fixtures below, deliberately. The first version of this test left them bare and
// the evidence string contains a colon, so the YAML failed to parse — which made several negative
// cases "pass" on a parse error rather than on the guard they exist to exercise. A broken fixture
// flatters a clean answer, so each negative now asserts WHY it failed, not just that it did.
const goodReason = "a reason long enough to be an actual explanation of the decision taken here"
const goodEvidence = "measured across four clusters - 30 live values, 0 rejected, control rejects buton"

func TestAcceptanceCoversOneClauseAtOnePlace(t *testing.T) {
	a := &Acceptance{Path: "*", PathSuffix: ".spec.widgetData.allowedResources[]", Clause: "enum"}

	if !a.Accepts("cards.widgets.templates.krateo.io/v1beta1.spec.widgetData.allowedResources[]",
		"gained an enum [x] where the baseline constrained nothing.") {
		t.Error("the finding it was written for must be covered")
	}

	// A DIFFERENT CLAUSE at the same path must still fail. Accepting an enum must not quietly
	// accept a later `required` on the same node — that is the slide this property exists to stop.
	if a.Accepts("cards.widgets.templates.krateo.io/v1beta1.spec.widgetData.allowedResources[]",
		"now requires [id], which the baseline did not.") {
		t.Error("a `required` finding must NOT be covered by an `enum` acceptance")
	}
	// A different PLACE, same clause, must also fail.
	if a.Accepts("cards.widgets.templates.krateo.io/v1beta1.spec.widgetData.items[]",
		"gained an enum [x] where the baseline constrained nothing.") {
		t.Error("a finding at another path must NOT be covered")
	}
}

func TestBareWildcardCannotAcceptEverything(t *testing.T) {
	// `*` is meaningful only alongside a suffix — "this node, on every kind". Without one it would
	// be a blanket pardon, so it covers nothing at all.
	a := &Acceptance{Path: "*", Clause: "enum"}
	if a.Accepts("anything.at.all/v1.spec.x", "gained an enum [x] where the baseline constrained nothing.") {
		t.Error("a bare `*` with no pathSuffix must accept nothing")
	}
}

func TestPrefixWildcard(t *testing.T) {
	a := &Acceptance{Path: "cards.widgets.templates.krateo.io/*", Clause: "type"}
	if !a.Accepts("cards.widgets.templates.krateo.io/v1beta1.spec.x", "changed type from \"string\" to \"integer\".") {
		t.Error("a prefix wildcard must cover a path under it")
	}
	if a.Accepts("flexes.widgets.templates.krateo.io/v1beta1.spec.x", "changed type from \"string\" to \"integer\".") {
		t.Error("a prefix wildcard must not cover another kind")
	}
}

func TestAnAcceptanceWithoutEvidenceIsNotLoadable(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"no evidence at all", `
- path: "x/v1.spec.a"
  clause: enum
  reason: "` + goodReason + `"
`},
		{"evidence that is a shrug", `
- path: "x/v1.spec.a"
  clause: enum
  reason: "` + goodReason + `"
  evidence: "n/a"
`},
		{"no reason", `
- path: "x/v1.spec.a"
  clause: enum
  evidence: "` + goodEvidence + `"
`},
		{"no clause — would cover every kind of tightening at that path", `
- path: "x/v1.spec.a"
  reason: "` + goodReason + `"
  evidence: "` + goodEvidence + `"
`},
		{"no path and no suffix", `
- clause: enum
  reason: "` + goodReason + `"
  evidence: "` + goodEvidence + `"
`},
	}
	for _, c := range cases {
		_, err := LoadAcceptances(write(t, c.body))
		if err == nil {
			t.Errorf("%s: must not load", c.name)
			continue
		}
		// It must fail on the GUARD, not on malformed YAML. A fixture that does not parse would
		// satisfy the assertion above while exercising nothing.
		if strings.Contains(err.Error(), "error converting YAML") {
			t.Errorf("%s: the fixture does not parse, so the guard was never exercised: %v",
				c.name, err)
		}
	}

	// And the shape that MUST load, so the guards cannot reject a real acceptance.
	ok := `
- path: "x/v1.spec.a"
  clause: enum
  accepted: 2026-11-04
  reason: "` + goodReason + `"
  evidence: "` + goodEvidence + `"
`
	got, err := LoadAcceptances(write(t, ok))
	if err != nil || len(got) != 1 {
		t.Fatalf("a complete acceptance must load: %v (%d entries)", err, len(got))
	}
	if got[0].Matched() != 0 {
		t.Error("a freshly loaded acceptance has matched nothing yet")
	}
}

func TestAMissingFileIsNotAnError(t *testing.T) {
	// A repo with no acceptances is the normal state, not a misconfiguration.
	got, err := LoadAcceptances(filepath.Join(t.TempDir(), "absent.yaml"))
	if err != nil || got != nil {
		t.Errorf("an absent file must yield no acceptances and no error: %v, %v", got, err)
	}
}

func TestClauseOfCoversEveryClauseTheComparisonProduces(t *testing.T) {
	// If the comparison grows a clause and this mapping does not, an acceptance for it can never
	// match — which the stale-entry check reports, but only after someone has written one. Pinning
	// the mapping here puts the failure at the point the clause is added.
	for _, c := range []struct{ why, want string }{
		{"now requires [a], which the baseline did not.", "required"},
		{"gained an enum [x] where the baseline constrained nothing.", "enum"},
		{"dropped [y] from its enum.", "enum"},
		{"changed type from \"string\" to \"integer\".", "type"},
		{"gained format \"date-time\" (baseline: \"\").", "format"},
		{"narrowed maxLength from 255 to 64.", "bounds"},
		{"gained minimum 5 where the baseline had no bound.", "bounds"},
		{"changed pattern from \"^a$\" to \"^a+$\".", "pattern"},
		{"no longer declares [a].", "properties"},
		{"no longer sets " + preserveUnknown + ".", "preserve-unknown"},
	} {
		if got := clauseOf(c.why); got != c.want {
			t.Errorf("clauseOf(%q) = %q, want %q", c.why[:min(40, len(c.why))], got, c.want)
		}
	}
	if got := clauseOf("some wording nobody has written yet"); got != "" {
		t.Errorf("an unmapped finding must yield no clause, got %q", got)
	}
}

func TestTheShippedAcceptancesLoad(t *testing.T) {
	// The real file, so a typo in it fails here rather than only in the networked gate.
	got, err := LoadAcceptances("accepted-tightenings.yaml")
	if err != nil {
		t.Fatalf("crdgen/accepted-tightenings.yaml: %v", err)
	}
	for _, a := range got {
		if !strings.Contains(a.Evidence, "0 of") && !strings.Contains(a.Evidence, "rejects 0") {
			// Not a hard rule about wording — a nudge that the evidence should carry a COUNT.
			t.Logf("note: the acceptance for %q cites no explicit count in its evidence",
				a.Path+a.PathSuffix)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
