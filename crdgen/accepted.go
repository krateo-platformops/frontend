package main

// Accepted tightenings: a reviewed, evidenced exception to the "no CRD may become stricter" gate.
//
// WHY AN EXCEPTION MECHANISM AT ALL. A gate with no way to record a reviewed exception has two
// futures and both are bad: it blocks legitimate work forever, or somebody deletes it. Neither is
// a gate. So an exception is possible and it costs a declaration — path, clause, reason, and
// EVIDENCE — because "we decided it was fine" is the sentence that made 1.8.20 shippable.
//
// THREE PROPERTIES KEEP IT FROM BECOMING A MUTE BUTTON:
//
//   1. An entry accepts ONE clause at ONE place. A different tightening at the same path still
//      fails, so accepting an enum does not quietly accept a later `required`.
//   2. `reason` and `evidence` are both mandatory and non-trivial. An entry that cannot say what
//      was measured is not an acceptance, it is a shrug.
//   3. An entry matching NOTHING is reported. Without that, acceptances accumulate as the schemas
//      move underneath them, the same failure as a stale allowlist. It warns rather than fails:
//      absorbed.go says why.

import (
	"fmt"
	"os"
	"strings"

	"sigs.k8s.io/yaml"
)

// Acceptance is one reviewed exception.
type Acceptance struct {
	// Path matches the finding's path literally, or as a prefix when it ends in "*".
	Path string `json:"path"`
	// PathSuffix, when set, must also match the end of the finding's path. It exists so an
	// acceptance can name a NODE that appears on many kinds ("allowedResources on every container")
	// without either listing 14 CRD names or degenerating to a bare "*" that accepts everything.
	PathSuffix string `json:"pathSuffix"`
	// Clause is the first word of the finding, e.g. "enum" or "required".
	Clause   string `json:"clause"`
	Accepted string `json:"accepted"`
	Reason   string `json:"reason"`
	Evidence string `json:"evidence"`

	matched int
}

// LoadAcceptances reads the file, failing on an entry that is not a real acceptance.
func LoadAcceptances(path string) ([]*Acceptance, error) {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []*Acceptance
	if err := yaml.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	for i, a := range out {
		switch {
		case a.Path == "" && a.PathSuffix == "":
			return nil, fmt.Errorf("%s entry %d: needs a path or a pathSuffix", path, i)
		case a.Clause == "":
			return nil, fmt.Errorf("%s entry %d: needs a clause", path, i)
		// The length floors are deliberately low — they are there to stop "n/a" and "fine", not to
		// legislate prose. A reviewer still has to read it; this only ensures there is something
		// to read.
		case len(strings.TrimSpace(a.Reason)) < 40:
			return nil, fmt.Errorf("%s entry %d (%s %s): reason is too short to be one",
				path, i, a.Path, a.Clause)
		case len(strings.TrimSpace(a.Evidence)) < 40:
			return nil, fmt.Errorf("%s entry %d (%s %s): evidence is missing. An acceptance "+
				"without a measurement is a shrug", path, i, a.Path, a.Clause)
		}
	}
	return out, nil
}

// Accepts reports whether this acceptance covers the finding, and records the match.
func (a *Acceptance) Accepts(findingPath, why string) bool {
	if a.Clause != clauseOf(why) {
		return false
	}
	if a.PathSuffix != "" && !strings.HasSuffix(findingPath, a.PathSuffix) {
		return false
	}
	switch {
	case a.Path == "*":
		// Only meaningful alongside a PathSuffix; a bare "*" with no suffix is rejected below.
		if a.PathSuffix == "" {
			return false
		}
	case strings.HasSuffix(a.Path, "*"):
		if !strings.HasPrefix(findingPath, strings.TrimSuffix(a.Path, "*")) {
			return false
		}
	default:
		if findingPath != a.Path {
			return false
		}
	}
	a.matched++
	return true
}

// Matched reports how many findings this acceptance covered, so a stale entry can be failed.
func (a *Acceptance) Matched() int { return a.matched }

// clauseOf names the clause a finding belongs to, from the wording Tightenings produces. Derived
// from the message rather than carried alongside it, so there is one source for the vocabulary —
// and a reworded finding that no longer maps is caught by the stale-entry check rather than
// silently ceasing to be accepted.
func clauseOf(why string) string {
	switch {
	case strings.HasPrefix(why, "now requires"):
		return "required"
	case strings.Contains(why, "enum"):
		return "enum"
	case strings.HasPrefix(why, "changed type"):
		return "type"
	case strings.HasPrefix(why, "gained format"):
		return "format"
	case strings.HasPrefix(why, "narrowed min"), strings.HasPrefix(why, "narrowed max"),
		strings.HasPrefix(why, "gained min"), strings.HasPrefix(why, "gained max"):
		return "bounds"
	case strings.HasPrefix(why, "changed pattern"), strings.HasPrefix(why, "gained pattern"):
		return "pattern"
	case strings.HasPrefix(why, "no longer declares"):
		return "properties"
	case strings.Contains(why, preserveUnknown):
		return "preserve-unknown"
	}
	return ""
}
