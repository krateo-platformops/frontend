package main

import (
	"os"
	"regexp"
	"testing"

	"sigs.k8s.io/yaml"
)

// retractedEntry is one published version installer must refuse to pin.
type retractedEntry struct {
	Version string   `json:"version"`
	Charts  []string `json:"charts"`
	Use     string   `json:"use"`
	Reason  string   `json:"reason"`
}

// TestRetractedVersionsIsWellFormed guards the file installer's CI reads. A malformed entry would
// not fail here by default: it would simply match nothing there, and the pin would go through.
func TestRetractedVersionsIsWellFormed(t *testing.T) {
	raw, err := os.ReadFile("../retracted-versions.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Retracted []retractedEntry `json:"retracted"`
	}
	if err := yaml.UnmarshalStrict(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Retracted) == 0 {
		t.Fatal("no entries: a parse that reads nothing must not pass")
	}
	semver := regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	known := map[string]bool{"builder-gate": true, "frontend": true, "frontend-crds": true}
	for _, entry := range file.Retracted {
		if !semver.MatchString(entry.Version) || !semver.MatchString(entry.Use) {
			t.Errorf("%q: version and use must be plain semver, got use %q", entry.Version, entry.Use)
		}
		if entry.Version == entry.Use {
			t.Errorf("%q: use names the retracted version itself", entry.Version)
		}
		if entry.Reason == "" {
			t.Errorf("%q: a retraction needs a reason", entry.Version)
		}
		if len(entry.Charts) == 0 {
			t.Errorf("%q: names no chart", entry.Version)
		}
		for _, chart := range entry.Charts {
			if !known[chart] {
				t.Errorf("%q: %q is not a chart this repo publishes (a component name would match nothing)", entry.Version, chart)
			}
		}
	}
}
