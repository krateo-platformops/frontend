package main

// Tightening comparison: does a widget CRD still admit every object the version in the field
// accepted? Separate file from the gate that calls it so the comparison is unit-testable OFFLINE —
// the gate needs the published baseline and therefore the network, and a clause that only runs
// when a registry answers is a clause nobody controls.
//
// THE ASYMMETRY THIS RESTS ON. Stored objects are not revalidated when a CRD changes, so a
// tightening is silent at the roll: the CRD step reports success, every existing CR keeps sitting
// in etcd, and the failure arrives at the NEXT write to one of them, attributed to whoever made
// that write. A loosening cannot do that. So this is one-directional by design and says nothing
// about a constraint that got looser — a check that fired on both would be turned off within a
// week for noise, taking the half that matters with it.
//
// THIS REPO IS WHERE THAT COST WAS PAID. frontend-crds 1.8.20 added `required: [id]` to a node
// defining only `iterator` and `template`, across all 44 widget CRDs. 29 live CRs became
// unappliable on demo and the recovery was a rollback. Three gates were green: crd-drift (compares
// the chart to the generator — both carried the defect identically), plumbing/crdgen's apiserver
// validation (a required-but-undefined property is legal OpenAPI), and TestNoRequiredPropertyIsUndefined
// did not exist yet. None of them was asking whether the new schema still admits what the old one
// accepted, which is a question about two artifacts at two MOMENTS rather than two artifacts now.

import (
	"fmt"
	"sort"
)

const preserveUnknown = "x-kubernetes-preserve-unknown-fields"

// Tightening is one way a schema node stopped admitting something it used to.
type Tightening struct {
	Path string
	Why  string
}

// boundKeys pairs each bound with the direction that makes it STRICTER: `minimum` and `minLength`
// tighten by rising, `maximum` and `maxLength` by falling. A table rather than four near-identical
// blocks, because the only thing that differs between them is the comparison and four hand-written
// copies is where the inverted one hides. The test pins every key in BOTH directions for that
// reason.
var boundKeys = []struct {
	key               string
	stricterWhenAbove bool
}{
	{"minimum", true},
	{"minLength", true},
	{"maximum", false},
	{"maxLength", false},
}

// Tightenings reports every way `new` admits less than `old`, at and below `path`.
func Tightenings(old, new map[string]any, path string) []Tightening {
	var out []Tightening
	add := func(format string, args ...any) {
		out = append(out, Tightening{Path: path, Why: fmt.Sprintf(format, args...)})
	}
	if old == nil || new == nil {
		return nil
	}

	if gained := missingFrom(stringList(new["required"]), stringList(old["required"])); len(gained) > 0 {
		add("now requires %v, which the baseline did not. Existing objects without those fields "+
			"can no longer be written.", gained)
	}

	oldEnum, newEnum := anyList(old["enum"]), anyList(new["enum"])
	switch {
	case newEnum != nil && oldEnum == nil:
		add("gained an enum %v where the baseline constrained nothing. Any other stored value is "+
			"now invalid.", scalarStrings(newEnum))
	case newEnum != nil && oldEnum != nil:
		if lost := missingFrom(scalarStrings(oldEnum), scalarStrings(newEnum)); len(lost) > 0 {
			add("dropped %v from its enum. Objects holding those values can no longer be "+
				"written.", lost)
		}
	}

	if oldType, newType := str(old["type"]), str(new["type"]); oldType != "" && newType != "" && oldType != newType {
		add("changed type from %q to %q.", oldType, newType)
	}

	if newFormat := str(new["format"]); newFormat != "" && newFormat != str(old["format"]) {
		add("gained format %q (baseline: %q). A value the baseline accepted may no longer "+
			"validate.", newFormat, str(old["format"]))
	}

	if old[preserveUnknown] == true && new[preserveUnknown] != true {
		add("no longer sets %s. This subtree tolerated arbitrary content in the baseline and now "+
			"prunes or refuses it.", preserveUnknown)
	}

	for _, b := range boundKeys {
		n, nOK := number(new[b.key])
		if !nOK {
			continue
		}
		o, oOK := number(old[b.key])
		switch {
		case !oOK:
			add("gained %s %v where the baseline had no bound. A stored value outside it can no "+
				"longer be written.", b.key, n)
		case b.stricterWhenAbove && n > o, !b.stricterWhenAbove && n < o:
			add("narrowed %s from %v to %v. Objects outside the new bound can no longer be "+
				"written.", b.key, o, n)
		}
	}

	// A CHANGED pattern is reported, not only an introduced one. Regex containment is undecidable
	// in general, so there is no cheap way to tell a widened pattern from a narrowed one — and
	// treating "changed" as safe is the assumption that loses data. The cost is a finding on a
	// genuine widening, which a reviewer reads once and waves through.
	if newPattern := str(new["pattern"]); newPattern != "" && newPattern != str(old["pattern"]) {
		add("changed pattern from %q to %q. Whether that admits everything the baseline did "+
			"cannot be decided here, so it is reported rather than assumed safe.",
			str(old["pattern"]), newPattern)
	}

	// A REMOVED property is the only clause here whose harm is not a refused write. Structural
	// pruning drops an undeclared field SILENTLY and admits the object, so an existing CR carrying
	// it loses that data on its next write with nothing reported anywhere — strictly worse than
	// the loud failure every other clause describes. Exempted under a node that tolerates unknown
	// content, where the field was never declared-and-validated to begin with.
	oldProps, newProps := object(old["properties"]), object(new["properties"])
	if lost := missingFrom(keys(oldProps), keys(newProps)); len(lost) > 0 && new[preserveUnknown] != true {
		add("no longer declares %v. Structural pruning drops an undeclared field SILENTLY and "+
			"admits the object, so a stored value is lost on the next write with no error "+
			"reported anywhere.", lost)
	}

	for _, k := range keys(newProps) {
		if o, ok := oldProps[k]; ok {
			out = append(out, Tightenings(object(o), object(newProps[k]), path+"."+k)...)
		}
	}
	if o, n := object(old["items"]), object(new["items"]); o != nil && n != nil {
		out = append(out, Tightenings(o, n, path+"[]")...)
	}
	if o, n := object(old["additionalProperties"]), object(new["additionalProperties"]); o != nil && n != nil {
		out = append(out, Tightenings(o, n, path+"{*}")...)
	}
	return out
}

// missingFrom returns the members of `want` absent from `have`, sorted, so a finding reads the same
// way twice.
func missingFrom(want, have []string) []string {
	in := make(map[string]bool, len(have))
	for _, h := range have {
		in[h] = true
	}
	var out []string
	for _, w := range want {
		if !in[w] {
			out = append(out, w)
		}
	}
	sort.Strings(out)
	return out
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// object accepts both shapes sigs.k8s.io/yaml can produce for a mapping.
func object(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

func anyList(v any) []any {
	if l, ok := v.([]any); ok {
		return l
	}
	return nil
}

func stringList(v any) []string {
	var out []string
	for _, e := range anyList(v) {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func scalarStrings(l []any) []string {
	out := make([]string, 0, len(l))
	for _, e := range l {
		out = append(out, fmt.Sprint(e))
	}
	sort.Strings(out)
	return out
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// number deliberately refuses bools. In Go a bool is not a float64 so this is not the hazard it is
// in Python, but the refusal is stated so a future reader does not add a bool case thinking it was
// an oversight: `maxLength: true` is a malformed schema, not a bound of 1.
func number(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}
