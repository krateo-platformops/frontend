// jqcheck compiles (and, for the data step's oversized inputs, evaluates) jq exactly the way
// snowplow does: the same gojq fork (go.mod's replace, as in snowplow's own go.mod) and the same
// built-in modules (modules/*.jq, copied from snowplow at the tag in SNOWPLOW_REF and embedded
// here, as snowplow embeds them).
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
	"fmt"
	"io"
	"os"
	"time"

	"github.com/itchyny/gojq"
)

//go:embed modules/*.jq
var modulesFS embed.FS

// moduleLoader resolves `include "quantity";` / `import "health" as h;` from the embedded copy
// of snowplow's built-in modules (internal/support/jq/modules.go layeredModuleLoader's fallback).
type moduleLoader struct{}

func (moduleLoader) LoadModule(name string) (*gojq.Query, error) {
	dat, err := modulesFS.ReadFile("modules/" + name + ".jq")
	if err != nil {
		return nil, fmt.Errorf("module %q not found: %w", name, err)
	}
	q, err := gojq.Parse(string(dat))
	if err != nil {
		return nil, fmt.Errorf("error parsing built-in module %q: %w", name, err)
	}
	return q, nil
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

func compile(q string) (*gojq.Code, error) {
	parsed, err := gojq.Parse(q)
	if err != nil {
		return nil, fmt.Errorf("invalid jq query: %w", err)
	}
	code, err := gojq.Compile(parsed, gojq.WithModuleLoader(moduleLoader{}))
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
