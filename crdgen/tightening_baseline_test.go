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
//   FRONTEND_CRDS_VERSION=<v>   compare against that version instead of the pin
//   PINNED_CRDS_DIR=<dir>       use an already-unpacked chart (no network)

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"sigs.k8s.io/yaml"
)

const pinsURL = "https://raw.githubusercontent.com/krateo-platformops/installer/main/" +
	"chart/files/component-pins.yaml"

// The pin entry is named `frontend-crd` while the chart it names is `frontend-crds`, plural. Read
// the entry rather than guessing either name — lint-pinned-crds.py records the same trap.
const pinName = "frontend-crd"

const chartRef = "oci://ghcr.io/krateo-platformops/charts/frontend-crds"

// crdVersions is every CRD version schema in a tree, keyed "<crd name>/<version>".
type crdVersions map[string]map[string]any

func TestNoWidgetCRDBecameStricter(t *testing.T) {
	version := os.Getenv("FRONTEND_CRDS_VERSION")
	source := "FRONTEND_CRDS_VERSION"
	if dir := os.Getenv("PINNED_CRDS_DIR"); dir == "" && version == "" {
		var err error
		version, err = pinnedVersion()
		if err != nil {
			// NOT a skip. A gate that cannot read its baseline has not checked anything, and
			// reporting that as a pass is the exact failure this file argues against elsewhere.
			t.Fatalf("could not determine the pinned frontend-crds version: %v", err)
		}
		source = "installer component-pins.yaml (.components[] name=" + pinName + ")"
	}

	baseDir := os.Getenv("PINNED_CRDS_DIR")
	if baseDir == "" {
		baseDir = pullChart(t, version)
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

	compared, newKinds := 0, 0
	for _, key := range sortedKeys(current) {
		base, ok := baseline[key]
		if !ok {
			// A new CRD or a new stored version has no objects in the field to break.
			newKinds++
			continue
		}
		compared++
		for _, hit := range Tightenings(base, current[key], key) {
			t.Errorf("%s %s\n    A tightening is SILENT at the roll: stored objects are not "+
				"revalidated, so this surfaces on the next WRITE to an existing object and is "+
				"attributed to whoever made that write.", hit.Path, hit.Why)
		}
	}
	t.Logf("compared %d CRD version(s) against the pin; %d are new and had no baseline",
		compared, newKinds)
	if compared == 0 {
		t.Fatalf("every CRD in the working tree was new to the baseline, so no comparison happened")
	}
}

func pinnedVersion() (string, error) {
	// Three attempts: a transient blip should not red an unrelated PR, but a gate that cannot read
	// the pin must not pass either — hence t.Fatalf at the call site rather than a skip.
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(3*attempt) * time.Second)
		}
		resp, err := http.Get(pinsURL)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("GET %s returned %d", pinsURL, resp.StatusCode)
			continue
		}
		var pins struct {
			Components []struct {
				Name    string `json:"name"`
				Version string `json:"version"`
			} `json:"components"`
		}
		if err := yaml.Unmarshal(body, &pins); err != nil {
			return "", fmt.Errorf("parsing the installer pins: %w", err)
		}
		for _, c := range pins.Components {
			if c.Name == pinName {
				if c.Version == "" {
					return "", fmt.Errorf("the %s pin entry carries no version", pinName)
				}
				return c.Version, nil
			}
		}
		return "", fmt.Errorf("no .components[] entry named %s in the installer pins", pinName)
	}
	return "", fmt.Errorf("after 3 attempts: %w", lastErr)
}

func pullChart(t *testing.T, version string) string {
	t.Helper()
	dir := t.TempDir()
	out, err := exec.Command("helm", "pull", chartRef, "--version", version,
		"--untar", "-d", dir).CombinedOutput()
	if err != nil {
		t.Fatalf("helm pull %s --version %s: %v\n%s", chartRef, version, err, out)
	}
	return filepath.Join(dir, "frontend-crds")
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
