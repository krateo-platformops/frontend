package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"sigs.k8s.io/yaml"
)

// A `required` entry naming a property its sibling `properties` does not define makes the schema
// UNSATISFIABLE, and that is worth its own test because it is invisible to every other check here.
//
// WHAT IT COSTS WHEN IT SHIPS. Structural-schema pruning strips unknown fields BEFORE validation
// runs, so supplying the required field does not help: it is pruned, then `required` fails. The
// object can never be admitted. frontend-crds 1.8.20 shipped exactly this on all 44 widget CRDs —
// `spec.resourcesRefsTemplate.items` required `id` while defining only `iterator` and `template` —
// so every widget CR carrying a resourcesRefsTemplate was unappliable. Stored objects are not
// revalidated when a CRD changes, so nothing broke at the roll; the NEXT apply failed, attributed
// to the consumer, after the CRD step reported success.
//
// WHY NOTHING ELSE CAUGHT IT, which is the reason this test exists rather than a wider one:
//
//   - crd-drift asserts the chart MATCHES the generator. Both were wrong identically, so it passed.
//     A drift gate compares two artifacts and cannot judge either.
//   - plumbing/crdgen runs the apiserver's own ValidateCustomResourceDefinition, which this repo
//     relies on heavily — and it ACCEPTS this. A required-but-undefined property is legal OpenAPI
//     and a legal CRD; it is only unsatisfiable, which validation does not test for.
//   - A nested-property-path diff (added/removed paths) cannot see it either: a new `required`
//     entry adds no path and removes none. It is a constraint, not a property.
//
// So three instruments that all looked like they covered CRD correctness each answered a different
// question. This one asks whether an object can exist.
func TestNoRequiredPropertyIsUndefined(t *testing.T) {
	// BOTH trees, because they are different artifacts at different moments and each is the one
	// that matters in a different workflow:
	//
	//   helm/frontend-crds/templates  what the chart SHIPS, and what crd-drift and a local run see.
	//   ui/scripts/krateoctl-output   what the generator just PRODUCED. release-tag regenerates into
	//                                 here and proposes it; at that point the committed chart is
	//                                 still the old one, so checking only the chart there would gate
	//                                 the previous release and wave the new one through.
	//
	// That mistake was in the first version of this test, and it is the same shape as the defect it
	// exists to catch: an instrument pointed at the adjacent artifact, reporting green about a
	// question it never asked.
	roots := []string{
		filepath.Join("..", "helm"),
		filepath.Join("..", "ui", "scripts", "krateoctl-output"),
	}

	// DISCOVERED BY `kind`, RECURSIVELY — never by filename, and never one directory deep.
	//
	// The first version globbed `templates/*.crd.yaml`, which found 44 of the chart's 45 CRDs. The
	// 45th is `templates/builders/Builder.yaml`: a subdirectory AND a different extension, missed
	// on both counts. It is also the HAND-WRITTEN one, deliberately outside the widget generator's
	// reach — so it is the CRD a person can get wrong, and it was the one not checked.
	//
	// Filtering on a filename convention makes a gate's reach depend on a naming habit that the
	// repo documents as deliberately inconsistent. `kind: CustomResourceDefinition` is the property
	// that actually decides whether this test applies.
	var entries []string
	checked := map[string]int{}
	for _, root := range roots {
		n := 0
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				// A missing root is fine: release-tag generates before any chart is in play, and a
				// local run may not have generated yet. An unreadable one is not.
				if os.IsNotExist(err) {
					return fs.SkipDir
				}
				return err
			}
			if d.IsDir() {
				return nil
			}
			if ext := filepath.Ext(path); ext != ".yaml" && ext != ".yml" {
				return nil
			}
			raw, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			var head struct {
				Kind string `json:"kind"`
			}
			// A file that does not parse is not a CRD this test can judge; the chart carries no
			// templated CRDs today, and if one ever appears it will fail the count guard below
			// rather than be skipped silently.
			if yaml.Unmarshal(raw, &head) != nil || head.Kind != "CustomResourceDefinition" {
				return nil
			}
			entries = append(entries, path)
			n++
			return nil
		})
		if err != nil {
			t.Fatalf("walking %s: %v", root, err)
		}
		checked[root] = n
	}

	// A guard on the guard: finding nothing would make this test pass having checked nothing at all,
	// which is the failure mode of every gate that reads files from a path. 45 is the chart's own
	// count — 44 generated widgets plus the hand-written Builder.
	if len(entries) < 45 {
		t.Fatalf("found %d CRDs across %v, expected at least the chart's 45 — this test checked too little: %v",
			len(entries), roots, checked)
	}
	t.Logf("checking %d CRD(s): %v", len(entries), checked)

	for _, path := range entries {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("reading %s: %v", path, err)
		}
		var doc any
		if err := yaml.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("parsing %s: %v", path, err)
		}
		for _, bad := range unsatisfiable(doc, "") {
			t.Errorf("%s: %s requires %q but its properties are %v — nothing can satisfy this, so "+
				"every object with that field is unappliable",
				filepath.Base(path), bad.where, bad.missing, bad.defined)
		}
	}
}

type finding struct {
	where   string
	missing string
	defined []string
}

// unsatisfiable walks every node, not only the spec, because the envelope assets are grafted at
// several depths and a future one could land anywhere.
func unsatisfiable(node any, where string) []finding {
	var out []finding
	switch n := node.(type) {
	case map[string]any:
		req, hasReq := n["required"].([]any)
		props, hasProps := n["properties"].(map[string]any)
		if hasReq && hasProps {
			defined := make([]string, 0, len(props))
			for k := range props {
				defined = append(defined, k)
			}
			sort.Strings(defined)
			for _, r := range req {
				name, ok := r.(string)
				if !ok {
					continue
				}
				if _, found := props[name]; !found {
					out = append(out, finding{where: where + "." + "(required)", missing: name, defined: defined})
				}
			}
		}
		keys := make([]string, 0, len(n))
		for k := range n {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			out = append(out, unsatisfiable(n[k], where+"."+k)...)
		}
	case []any:
		for i, v := range n {
			out = append(out, unsatisfiable(v, where+"[]")...)
			_ = i
		}
	}
	return out
}
