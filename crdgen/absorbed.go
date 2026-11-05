package main

// Telling a SAFE-ORDERING acceptance from a ROTTEN one, without inventing any new state.
//
// THE FLAW THIS FIXES, found by the core-provider session the day the acceptance mechanism shipped.
// "An entry matching nothing is itself a finding" is the property that stops acceptances
// accumulating — but it cannot, on its own, tell apart:
//
//	A. an entry added BEFORE the tightening it excuses exists. Deliberate ordering, and good
//	   practice: the acceptance is reviewed in its own change rather than buried in the one that
//	   needs it.
//	B. an entry that matched yesterday and matches nothing today. Either the tightening SHIPPED, in
//	   which case the entry is spent cruft, or the finding was reworded and the entry now excuses
//	   nothing while looking like it does.
//
// Conflating them makes the rule flag good practice, and a rule that flags good practice is one
// people route around.
//
// WHY THERE IS NO LOCK FILE. The obvious design is a committed record of what matched on the last
// green run. A committed file is editable by the PR it is meant to constrain, and CI artifacts need
// API access and do not exist on a first run. Both are new state to keep honest.
//
// The record already exists: THE PUBLISHED HISTORY. A tightening that shipped is, by definition,
// present in the release that carries it — so comparing the PREVIOUS published version against the
// pinned one reproduces exactly the finding the acceptance was written for, from two immutable
// artifacts nobody can edit after the fact:
//
//	the entry matches that historical comparison  -> the tightening SHIPPED. Spent; warn, delete it.
//	it matches neither history nor today          -> not yet applicable. Case A, and fine.
//
// Case B's other arm — a reworded finding — needs no special handling: the tightening is still live
// between the pin and the working tree, so the gate reports it as an UNEXCUSED finding already.
//
// THE PREVIOUS VERSION IS PROBED, NOT COMPUTED. frontend-crds 1.8.17, 1.8.18 and 1.8.19 are all
// tags whose chart was never published, so "the pin minus one patch" names an artifact that does
// not exist. The walk steps down until the registry answers.

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// maxVersionWalk bounds the probe. Chosen to clear the largest publish gap this estate has had
// (1.8.17..1.8.19, three) by a wide margin while keeping the worst case to a few seconds of
// registry calls on a run where an acceptance is already unmatched — which is rare by design.
const maxVersionWalk = 30

var semverRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)$`)

// previousPublished returns the highest published version strictly below `version`, or "" when
// there is none within the walk. A chart with no earlier release is a real and unremarkable state:
// an unmatched acceptance there can only be case A.
func previousPublished(ref, version string) (string, error) {
	m := semverRe.FindStringSubmatch(version)
	if m == nil {
		return "", fmt.Errorf("baseline version %q is not a plain semver, so its predecessor "+
			"cannot be probed", version)
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])

	for range maxVersionWalk {
		patch--
		if patch < 0 {
			// Not walking back across a minor. A tightening's predecessor being more than
			// maxVersionWalk patches away, or in an earlier minor, is rare enough that saying "I
			// could not determine it" beats guessing at the version scheme.
			return "", nil
		}
		candidate := fmt.Sprintf("%d.%d.%d", major, minor, patch)
		out, err := exec.Command("helm", "show", "chart", ref, "--version", candidate).CombinedOutput()
		if err == nil {
			return candidate, nil
		}
		// A "not found" is the expected answer for an unpublished tag and is how the walk steps
		// over the 1.8.17..1.8.19 gap. Anything else is a real failure and must not read as a gap,
		// or a registry outage would silently look like a chart with no history — which would
		// classify every unmatched acceptance as case A and excuse genuine rot.
		if !strings.Contains(string(out), "not found") && !strings.Contains(string(out), "NAME_UNKNOWN") {
			return "", fmt.Errorf("probing %s %s: %w\n%s", ref, candidate, err, out)
		}
	}
	return "", nil
}

// Classification of an acceptance that matched nothing in the live comparison.
type unmatchedKind int

const (
	// notYetApplicable: the tightening is in neither the published history nor the working tree.
	// Case A — an acceptance reviewed ahead of the change that needs it.
	notYetApplicable unmatchedKind = iota
	// absorbed: the tightening is visible between the previous published version and the pin, so
	// it shipped. The entry has done its job and is now cruft.
	absorbed
)

// classifyUnmatched decides why `a` matched nothing, using only published artifacts.
func classifyUnmatched(a *Acceptance, historical map[string][]Tightening) unmatchedKind {
	for key, hits := range historical {
		_ = key
		for _, hit := range hits {
			// A throwaway copy: Accepts records a match, and this probe must not make the entry
			// look matched to the live check.
			probe := Acceptance{Path: a.Path, PathSuffix: a.PathSuffix, Clause: a.Clause}
			if probe.Accepts(hit.Path, hit.Why) {
				return absorbed
			}
		}
	}
	return notYetApplicable
}
