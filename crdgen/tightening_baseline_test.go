//go:build baseline

package main

// No widget CRD may become STRICTER than the version the platform PINS.
//
// BEHIND A BUILD TAG, deliberately. This gate needs the published baseline, so it needs the network
// and a helm binary. Left in the default `go test ./...` it would red every offline run and the
// usual repair for that is a skip — at which point it also skips in CI and the gate is decoration.
// A tag makes the requirement explicit instead: crd-drift runs it as its own step, where a failure
// to reach the baseline is a FAILURE and not a skip. The comparison it calls is exercised offline
// by TestTightenings, so nothing here is the only cover for a clause.
//
// WHY THE PIN RATHER THAN LATEST-PUBLISHED. The pin is the CRD live clusters are serving, so it is
// the one with objects stored against it, and a tightening relative to it is the one that breaks a
// write. Latest-published can be ahead of every cluster. This is the same choice
// lint-pinned-crds.py makes for the same reason, and that script exists because CI once validated
// widgets against latest while krateo-057 ran an older pin — green on a chart the live apiserver
// would refuse.
//
// Overrides, matching lint-pinned-crds.py's names so there is one convention:
//   FRONTEND_CRDS_VERSION=<v>   compare against that version instead of the released pin
//   PINNED_CRDS_DIR=<dir>       use an already-unpacked chart (no network)

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"

	"sigs.k8s.io/yaml"
)

const installerRef = "oci://ghcr.io/krateo-platformops/charts/installer"

// The pin entry is named `frontend-crd` while the chart it names is `frontend-crds`, plural. Read
// the entry rather than guessing either name — lint-pinned-crds.py records the same trap.
const pinName = "frontend-crd"

const chartRef = "oci://ghcr.io/krateo-platformops/charts/frontend-crds"

// DefaultCRDsRef is chartRef under the name absorbed.go's probe reads, so the two cannot drift.
const DefaultCRDsRef = chartRef

// crdVersions is every CRD version schema in a tree, keyed "<crd name>/<version>".
type crdVersions map[string]map[string]any

func TestNoWidgetCRDBecameStricter(t *testing.T) {
	version := os.Getenv("FRONTEND_CRDS_VERSION")
	source := "FRONTEND_CRDS_VERSION"
	if dir := os.Getenv("PINNED_CRDS_DIR"); dir == "" && version == "" {
		var err error
		var installer string
		version, installer, err = pinnedVersion(t.TempDir())
		if err != nil {
			// NOT a skip. A gate that cannot read its baseline has not checked anything, and
			// reporting that as a pass is the exact failure this file argues against elsewhere.
			t.Fatalf("could not determine the pinned frontend-crds version: %v", err)
		}
		source = "released installer " + installer + " files/component-pins.yaml (name=" + pinName + ")"
	}

	baseDir := os.Getenv("PINNED_CRDS_DIR")
	if baseDir == "" {
		var perr error
		baseDir, perr = pullChart(t, version)
		if perr != nil {
			t.Fatalf("reading the baseline: %v", perr)
		}
		t.Logf("baseline: frontend-crds %s (%s)", version, source)
	} else {
		t.Logf("baseline: unpacked chart at %s (PINNED_CRDS_DIR)", baseDir)
	}

	baseline := collect(t, []string{baseDir})

	// BOTH trees, for the reason TestNoRequiredPropertyIsUndefined records: the chart is what
	// ships and what a local run sees, while ui/scripts/generated-crds is what the generator just
	// PRODUCED — and at release time the committed chart is still the old one, so checking only the
	// chart there would gate the previous release and wave the new one through.
	current := collect(t, []string{
		filepath.Join("..", "helm"),
		filepath.Join("..", "ui", "scripts", "generated-crds"),
	})

	// The same guard-on-the-guard as the satisfiability test: 45 is the chart's own count, 44
	// generated widgets plus the hand-written Builder. A tree that yielded nothing would make this
	// pass having compared nothing.
	if len(current) < 45 {
		t.Fatalf("found %d CRD version(s) in the working tree, expected at least the chart's 45 — "+
			"this test compared too little", len(current))
	}
	if len(baseline) == 0 {
		t.Fatalf("the baseline chart yielded no CRDs, so nothing was compared")
	}

	// A reviewed, evidenced exception is allowed; see accepted.go for why a gate needs one and
	// what stops it becoming a mute button.
	accepted, err := LoadAcceptances("accepted-tightenings.yaml")
	if err != nil {
		t.Fatalf("reading the accepted tightenings: %v", err)
	}

	compared, newKinds, excused := 0, 0, 0
	for _, key := range sortedKeys(current) {
		base, ok := baseline[key]
		if !ok {
			// A new CRD or a new stored version has no objects in the field to break.
			newKinds++
			continue
		}
		compared++
		for _, hit := range Tightenings(base, current[key], key) {
			covered := false
			for _, a := range accepted {
				if a.Accepts(hit.Path, hit.Why) {
					covered = true
					break
				}
			}
			if covered {
				excused++
				continue
			}
			t.Errorf("%s %s\n    A tightening is SILENT at the roll: stored objects are not "+
				"revalidated, so this surfaces on the next WRITE to an existing object and is "+
				"attributed to whoever made that write.\n    If this is intended, it needs an "+
				"entry in crdgen/accepted-tightenings.yaml carrying the measurement that "+
				"justifies it — not a reason, a COUNT of the live objects it would refuse.",
				hit.Path, hit.Why)
		}
	}

	// A STALE ACCEPTANCE IS ITSELF A FINDING — but only once it is known to be stale rather than
	// merely early. See absorbed.go for why the published history is the record that tells those
	// apart, and why there is no lock file.
	var unmatched []*Acceptance
	for _, a := range accepted {
		if a.Matched() == 0 {
			unmatched = append(unmatched, a)
		}
	}
	if len(unmatched) > 0 {
		// Only paid for when something is already unmatched, which is rare by design.
		prev, err := previousPublished(DefaultCRDsRef, version)
		if err != nil {
			// NOT degraded to "assume no history": that would classify every unmatched entry as
			// merely early and excuse genuine rot, which is the exact failure this check exists to
			// prevent. A probe that cannot answer must say so.
			t.Fatalf("could not probe the published version before %s, so an unmatched acceptance "+
				"cannot be told from a stale one: %v", version, err)
		}
		historical := map[string][]Tightening{}
		switch prev {
		case "":
			t.Logf("no published version below %s within the walk, so an unmatched acceptance can "+
				"only be one added ahead of the change that needs it", version)
		default:
			older, perr := pullChart(t, prev)
			if perr != nil {
				t.Fatalf("could not read the published version before %s (%s): %v", version, prev, perr)
			}
			oldBaseline := collect(t, []string{older})
			for key, schema := range baseline {
				if o, ok := oldBaseline[key]; ok {
					if hits := Tightenings(o, schema, key); len(hits) > 0 {
						historical[key] = hits
					}
				}
			}
			t.Logf("classifying %d unmatched acceptance(s) against the published history %s -> %s",
				len(unmatched), prev, version)
		}
		for _, a := range unmatched {
			switch classifyUnmatched(a, historical) {
			case absorbed:
				t.Errorf("accepted-tightenings.yaml: the entry for %q %s (%s) matched no finding "+
					"because the tightening it excused HAS SHIPPED — it is present between the "+
					"published %s and %s. The entry has done its job and is now cruft that makes "+
					"this file overstate what is currently excused. Delete it.",
					a.Path+a.PathSuffix, a.Clause, a.Accepted, prev, version)
			case notYetApplicable:
				t.Logf("accepted-tightenings.yaml: the entry for %q %s (%s) matches nothing yet "+
					"and the tightening is in neither the published history nor the working tree, "+
					"so it was added ahead of the change that needs it. Allowed.",
					a.Path+a.PathSuffix, a.Clause, a.Accepted)
			}
		}
	}
	if excused > 0 {
		t.Logf("%d finding(s) covered by a reviewed acceptance", excused)
	}
	t.Logf("compared %d CRD version(s) against the pin; %d are new and had no baseline",
		compared, newKinds)
	if compared == 0 {
		t.Fatalf("every CRD in the working tree was new to the baseline, so no comparison happened")
	}
}

// pinnedVersion reads the pin out of the RELEASED installer chart, and returns the installer version
// it read so the run log can name its source.
//
// NOT installer's `main`, which this first read, and that was wrong in a way this gate cannot detect
// by itself. A merged pin describes no cluster: on 2026-11-05 main said frontend-crd 1.8.22 and
// portal 1.8.91, the released chart said 1.8.21 and 1.8.88, and krateo-057 served the released
// ones. Reading main moved the baseline forward on a merge, so #612's `required: [id]` on 44 CRDs
// had stopped being a finding before any cluster had received it. The baseline must advance on
// release, never on merge: ahead of deployment is the direction that hides a tightening.
func pinnedVersion(dir string) (version, installer string, err error) {
	out, err := exec.Command("helm", "pull", installerRef, "--untar", "-d", dir).CombinedOutput()
	if err != nil {
		return "", "", fmt.Errorf("helm pull %s: %w\n%s", installerRef, err, out)
	}
	chart, err := os.ReadFile(filepath.Join(dir, "installer", "Chart.yaml"))
	if err != nil {
		return "", "", err
	}
	var meta struct {
		Version string `json:"version"`
	}
	if err := yaml.Unmarshal(chart, &meta); err != nil {
		return "", "", fmt.Errorf("parsing the installer chart metadata: %w", err)
	}
	pins, err := os.ReadFile(filepath.Join(dir, "installer", "files", "component-pins.yaml"))
	if err != nil {
		return "", "", fmt.Errorf("the released installer %s carries no pins file: %w", meta.Version, err)
	}
	version, err = pinFrom(pins, pinName)
	return version, meta.Version, err
}

func pullChart(t *testing.T, version string) (string, error) {
	t.Helper()
	dir := t.TempDir()
	out, err := exec.Command("helm", "pull", chartRef, "--version", version,
		"--untar", "-d", dir).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("helm pull %s --version %s: %w\n%s", chartRef, version, err, out)
	}
	return filepath.Join(dir, "frontend-crds"), nil
}

// collect walks for CRDs by `kind`, recursively — never by filename and never one directory deep.
// The satisfiability test records why: globbing `templates/*.crd.yaml` found 44 of the chart's 45,
// missing `templates/builders/Builder.yaml` on both counts, and that 45th is the HAND-WRITTEN one,
// so it was the CRD a person can get wrong and the one not checked.
func collect(t *testing.T, roots []string) crdVersions {
	t.Helper()
	out := crdVersions{}
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
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
			var doc struct {
				Kind     string `json:"kind"`
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Spec struct {
					Versions []struct {
						Name   string `json:"name"`
						Schema struct {
							OpenAPIV3Schema json.RawMessage `json:"openAPIV3Schema"`
						} `json:"schema"`
					} `json:"versions"`
				} `json:"spec"`
			}
			if yaml.Unmarshal(raw, &doc) != nil || doc.Kind != "CustomResourceDefinition" {
				return nil
			}
			for _, v := range doc.Spec.Versions {
				if len(v.Schema.OpenAPIV3Schema) == 0 {
					continue
				}
				var schema map[string]any
				if err := yaml.Unmarshal(v.Schema.OpenAPIV3Schema, &schema); err != nil {
					return fmt.Errorf("parsing %s %s schema: %w", path, v.Name, err)
				}
				// First tree wins: helm/ is listed before the generator output, so when both
				// carry a kind the SHIPPED one is compared. crd-drift asserts they are identical
				// anyway, and when they are not, that gate is the one that should say so.
				key := doc.Metadata.Name + "/" + v.Name
				if _, seen := out[key]; !seen {
					out[key] = schema
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walking %s: %v", root, err)
		}
	}
	return out
}

func sortedKeys(m crdVersions) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
