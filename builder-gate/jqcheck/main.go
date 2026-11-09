// jqcheck compiles (and, for the data step's oversized inputs, evaluates) jq exactly the way
// snowplow does: the same gojq fork (go.mod's replace, as in snowplow's own go.mod) and the same
// built-in modules (modules/, copied from snowplow at the tag in SNOWPLOW_REF and embedded here,
// as snowplow embeds them, nested names included).
//
// The gate talks to it over stdin/stdout, one JSON request per process:
//
//	{"mode":"compile","exprs":[{"id":"…","query":"…"}]}
//	  → {"results":[{"id":"…","ok":true}|{"id":"…","ok":false,"error":"…"}]}
//	{"mode":"eval","query":"…","data":<any>}
//	  → {"ok":true,"value":<any>}|{"ok":false,"error":"…"}
//
// Compile is gojq.Parse then gojq.Compile with the module loader: the two calls plumbing's
// jqutil.Eval makes before it runs anything. Nothing here reads the network or the disk.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/itchyny/gojq"
)

// snowplow's module loader (internal/support/jq/modules.go at SNOWPLOW_REF), ported rule for
// rule: the built-in modules embedded below, and the operator modules in the directory
// JQ_MODULES_PATH names, read the same way snowplow reads them. The chart mounts snowplow's own
// operator-modules ConfigMap there (values `snowplowJqModulesConfigMap`), so both read one source.
//
//   - A built-in module named N is the file modules/N.jq. A name may contain '/':
//     `include "krateo/architecture/v1"` loads modules/krateo/architecture/v1.jq.
//   - The names that resolve are ENUMERATED by walking the embedded tree for *.jq files at any
//     depth. A name outside that set is "not found", whatever path it spells — `./health` or
//     `krateo/../health` resolves in neither snowplow nor here.
//   - Every built-in name is RESERVED: it always loads the built-in, and an operator file of the
//     same name is never read (#639). Any other name is an operator module: the file
//     $JQ_MODULES_PATH/N.jq, refused when N is not a local path (absolute, or climbing out with
//     ".."). Only a missing file is "not found"; an unreadable or unparsable one FAILS the
//     expression, as in snowplow. JQ_MODULES_PATH unset, or blank, means built-ins only.
//   - Files are read when an expression includes them, never cached: jqcheck runs once per
//     request, so an edited ConfigMap is seen as soon as the kubelet updates the mount — as
//     snowplow, which also reads the file on every load, sees it.
//   - A `*.jq` embed pattern does not descend into subdirectories, so each nested directory is
//     listed on the line below, as on snowplow's. TestEveryModuleSourceIsEmbedded fails when a
//     vendored file is missing from it.
const (
	builtinRoot = "modules"
	moduleExt   = ".jq"
)

//go:embed modules/*.jq modules/krateo/architecture/*.jq
var modulesFS embed.FS

// builtinModuleNames is snowplow's builtinModuleNames: every *.jq under root, at any depth, as the
// name an import or include uses. Sorted.
func builtinModuleNames(fsys fs.FS, root string) []string {
	var names []string
	_ = fs.WalkDir(fsys, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, moduleExt) {
			return nil
		}
		rel := strings.TrimPrefix(p, root+"/")
		names = append(names, strings.TrimSuffix(rel, moduleExt))
		return nil
	})
	sort.Strings(names)
	return names
}

// envModulesPath names the operator-modules directory, as in snowplow (EnvModulesPath).
const envModulesPath = "JQ_MODULES_PATH"

// customDirFromEnv is snowplow's ModuleLoader reading of the variable: set means its trimmed
// value, and a blank value means no operator modules.
func customDirFromEnv() string {
	if basePath, ok := os.LookupEnv(envModulesPath); ok {
		return strings.TrimSpace(basePath)
	}
	return ""
}

// moduleLoader is snowplow's layeredModuleLoader: a reserved name loads from the embedded set,
// any other name from the operator directory.
type moduleLoader struct {
	builtin   fs.FS
	root      string
	reserved  map[string]struct{}
	customDir string // "" = no operator modules
}

func newModuleLoader(builtin fs.FS, root, customDir string) moduleLoader {
	l := moduleLoader{builtin: builtin, root: root, reserved: map[string]struct{}{}, customDir: customDir}
	for _, n := range builtinModuleNames(builtin, root) {
		l.reserved[n] = struct{}{}
	}
	return l
}

var loader = newModuleLoader(modulesFS, builtinRoot, customDirFromEnv())

func (l moduleLoader) LoadModule(name string) (*gojq.Query, error) {
	if _, ok := l.reserved[name]; ok {
		return l.loadBuiltin(name)
	}
	return l.loadCustom(name)
}

func (l moduleLoader) loadBuiltin(name string) (*gojq.Query, error) {
	dat, err := fs.ReadFile(l.builtin, path.Join(l.root, name+moduleExt))
	if err != nil {
		return nil, fmt.Errorf("built-in module %q: %w", name, err)
	}
	parsed, err := gojq.Parse(string(dat))
	if err != nil {
		return nil, fmt.Errorf("error parsing built-in module %q: %w", name, err)
	}
	return parsed, nil
}

// loadCustom is snowplow's: only a missing file is "not found"; every other failure — an
// unreadable file, a parse error, a name that would escape the directory — fails the expression.
func (l moduleLoader) loadCustom(name string) (*gojq.Query, error) {
	if l.customDir == "" {
		return nil, fmt.Errorf("module %q not found", name)
	}
	p, ok := l.customPath(name)
	if !ok {
		return nil, fmt.Errorf("module %q: invalid module name", name)
	}
	dat, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("module %q not found", name)
	}
	if err != nil {
		return nil, fmt.Errorf("custom module %q: unable to read: %w", name, err)
	}
	parsed, err := gojq.Parse(string(dat))
	if err != nil {
		return nil, fmt.Errorf("custom module %q: parse error: %w", name, err)
	}
	return parsed, nil
}

// customPath is snowplow's: a name that is not a local path (absolute, or climbing out with "..")
// is refused.
func (l moduleLoader) customPath(name string) (string, bool) {
	rel := filepath.FromSlash(name) + moduleExt
	if !filepath.IsLocal(rel) {
		return "", false
	}
	return filepath.Join(l.customDir, rel), true
}

type expr struct {
	ID    string `json:"id"`
	Query string `json:"query"`
}

type request struct {
	Mode  string `json:"mode"`
	Exprs []expr `json:"exprs"`
	Query string `json:"query"`
	Data  any    `json:"data"`
}

type result struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func compile(q string) (*gojq.Code, error) { return compileWith(loader, q) }

func compileWith(l gojq.ModuleLoader, q string) (*gojq.Code, error) {
	parsed, err := gojq.Parse(q)
	if err != nil {
		return nil, fmt.Errorf("invalid jq query: %w", err)
	}
	code, err := gojq.Compile(parsed, gojq.WithModuleLoader(l))
	if err != nil {
		return nil, fmt.Errorf("unable to compile jq query: %w", err)
	}
	return code, nil
}

// eval mirrors jqutil.Eval's control flow: stop on the first error value, and more than one
// yielded value is what snowplow concatenates (and then fails to decode), so it is an error here.
func eval(q string, data any) (any, error) {
	code, err := compile(q)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	iter := code.RunWithContext(ctx, data)
	var out any
	n := 0
	for {
		v, ok := iter.Next()
		if !ok {
			break
		}
		if e, isErr := v.(error); isErr {
			return nil, e
		}
		n++
		out = v
	}
	if n == 0 {
		return nil, fmt.Errorf("jq query yielded no value")
	}
	if n > 1 {
		return nil, fmt.Errorf("jq query yielded %d values; snowplow expects exactly one", n)
	}
	return out, nil
}

func main() {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<20))
	if err != nil {
		fail(err)
	}
	// Plain Unmarshal (numbers as float64), as snowplow decodes the api responses it filters.
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		fail(fmt.Errorf("bad request: %w", err))
	}
	enc := json.NewEncoder(os.Stdout)
	switch req.Mode {
	case "compile":
		results := make([]result, 0, len(req.Exprs))
		for _, e := range req.Exprs {
			if _, err := compile(e.Query); err != nil {
				results = append(results, result{ID: e.ID, Error: err.Error()})
				continue
			}
			results = append(results, result{ID: e.ID, OK: true})
		}
		_ = enc.Encode(map[string]any{"results": results})
	case "eval":
		v, err := eval(req.Query, req.Data)
		if err != nil {
			_ = enc.Encode(map[string]any{"ok": false, "error": err.Error()})
			return
		}
		_ = enc.Encode(map[string]any{"ok": true, "value": v})
	default:
		fail(fmt.Errorf("unknown mode %q", req.Mode))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(2)
}
