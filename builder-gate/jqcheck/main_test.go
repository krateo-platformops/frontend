package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// builtinsOnly is snowplow's loader with JQ_MODULES_PATH unset, whatever the test's environment says.
var builtinsOnly = newModuleLoader(modulesFS, builtinRoot, "")

// operatorDir writes files (name → content, name relative, '/' allowed) into a fresh directory.
func operatorDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

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
		if _, err := compileWith(builtinsOnly, q); err != nil {
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
		_, err := compileWith(builtinsOnly, `include "`+name+`"; .`)
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

// snowplow's operator modules (JQ_MODULES_PATH): what snowplow on a real cluster resolves beyond its
// built-ins. Each case is snowplow 1.12.67's loadCustom / customPath rule.
func TestOperatorModulesResolveAsSnowplowDoes(t *testing.T) {
	dir := operatorDir(t, map[string]string{
		"custom.jq":       "def custom_twice: . * 2;",
		"team/helpers.jq": "def team_helper: \"ok\";",
		"health.jq":       "def not_the_builtin: 1;", // a reserved name: never read
		"broken.jq":       "def broken: ;",
		"unreadable.jq/x": "", // a DIRECTORY named unreadable.jq: reading it fails, not "missing"
	})
	l := newModuleLoader(modulesFS, builtinRoot, dir)
	for _, q := range []string{
		`include "custom"; custom_twice`,
		`import "custom" as c; c::custom_twice`,
		`include "team/helpers"; team_helper`,
		`include "krateo/architecture/v1"; architecture_state`,
	} {
		if _, err := compileWith(l, q); err != nil {
			t.Errorf("%s: %v", q, err)
		}
	}
	for q, want := range map[string]string{
		// #639: the built-in wins; the operator file of the same name is not read.
		`include "health"; not_the_builtin`: `function not defined: not_the_builtin/0`,
		`include "missing"; .`:              `module "missing" not found`,
		`include "../custom"; .`:            `module "../custom": invalid module name`,
		`include "/etc/custom"; .`:          `module "/etc/custom": invalid module name`,
		`include "team/../../custom"; .`:    `module "team/../../custom": invalid module name`,
		`include "broken"; .`:               `custom module "broken": parse error`,
		`include "unreadable"; .`:           `custom module "unreadable": unable to read`,
	} {
		_, err := compileWith(l, q)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: %v, want it to contain %s", q, err, want)
		}
	}
}

// Without the directory, an operator module is not found: the false red this loader closes.
func TestOperatorModulesNeedTheDirectory(t *testing.T) {
	_, err := compileWith(builtinsOnly, `include "custom"; .`)
	if err == nil || !strings.Contains(err.Error(), `module "custom" not found`) {
		t.Fatalf("built-ins only: %v, want not found", err)
	}
	gone := filepath.Join(t.TempDir(), "absent")
	_, err = compileWith(newModuleLoader(modulesFS, builtinRoot, gone), `include "custom"; .`)
	if err == nil || !strings.Contains(err.Error(), `module "custom" not found`) {
		t.Fatalf("a directory that does not exist: %v, want not found", err)
	}
}

func TestCustomDirFromEnvIsSnowplowsReading(t *testing.T) {
	t.Setenv(envModulesPath, "  /jq-modules \n")
	if got := customDirFromEnv(); got != "/jq-modules" {
		t.Errorf("trimmed: %q", got)
	}
	t.Setenv(envModulesPath, "   ")
	if got := customDirFromEnv(); got != "" {
		t.Errorf("blank means none: %q", got)
	}
	os.Unsetenv(envModulesPath)
	if got := customDirFromEnv(); got != "" {
		t.Errorf("unset means none: %q", got)
	}
}
