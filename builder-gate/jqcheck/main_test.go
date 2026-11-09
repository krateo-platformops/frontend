package main

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

// Every vendored module on disk is in the embedded set. A `*.jq` embed pattern does not descend
// into subdirectories, so a nested directory vendored without its own pattern on the //go:embed
// line would be silently absent: its include would be "not found" here while snowplow resolves it.
// snowplow enforces the same with TestIssue639_EveryModuleSourceIsEmbedded.
func TestEveryModuleSourceIsEmbedded(t *testing.T) {
	onDisk := builtinModuleNames(os.DirFS("."), builtinRoot)
	embedded := builtinModuleNames(modulesFS, builtinRoot)
	if !reflect.DeepEqual(onDisk, embedded) {
		t.Fatalf("vendored modules %v, embedded %v: add the missing directory to the //go:embed line", onDisk, embedded)
	}
	// Guard on the guard: the walk found the nested module, so it does descend.
	if !contains(embedded, "krateo/architecture/v1") {
		t.Fatalf("the embedded set %v lacks krateo/architecture/v1", embedded)
	}
}

func TestBuiltinModuleNamesAreTheIncludeNames(t *testing.T) {
	got := builtinModuleNames(modulesFS, builtinRoot)
	want := []string{"health", "krateo/architecture/v1", "quantity"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("builtinModuleNames = %v, want %v", got, want)
	}
}

func TestIncludeResolvesAsSnowplowDoes(t *testing.T) {
	for _, q := range []string{
		`include "krateo/architecture/v1"; architecture_state`,
		`include "krateo/architecture/v1"; arch_step`,
		`import "krateo/architecture/v1" as a; a::fold_steps([])`,
		`include "quantity"; .`,
		`import "health" as h; .`,
	} {
		if _, err := compile(q); err != nil {
			t.Errorf("%s: %v", q, err)
		}
	}
}

// A name outside the enumerated set is not found, whatever file path it spells: snowplow looks the
// name up in its reserved set before it reads anything, and so does this loader.
func TestANameOutsideTheSetIsNotFound(t *testing.T) {
	for _, name := range []string{
		"krateo/architecture/v2",
		"krateo/architecture",
		"krateo/Architecture/v1",
		"architecture/v1",
		"./health",
		"krateo/../health",
		"modules/health",
		"health.jq",
		"custom",
	} {
		_, err := compile(`include "` + name + `"; .`)
		if err == nil {
			t.Errorf("%q: compiled", name)
			continue
		}
		if want := `module "` + name + `" not found`; !strings.Contains(err.Error(), want) {
			t.Errorf("%q: %v, want it to contain %s", name, err, want)
		}
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
