package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/krateo-platformops/plumbing/crdgen"
)

const (
	widgetsGroup = "widgets.templates.krateo.io"

	// A widget's `status` is whatever its data source resolved to, so the CRD cannot describe it
	// and must not prune it. This is the one place preserve-unknown is correct for a widget CRD:
	// `spec` stays strict (an undeclared key there is a mistake worth refusing), `status` stays open.
	statusSchema = `{"type": "object", "additionalProperties": true,"x-kubernetes-preserve-unknown-fields": true}`
)

func main() {
	out := flag.String("out", "", "where to write the CRD (default: <schema-dir>/<name>.crd.yaml)")
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), `gencrd — generate a Krateo widget CRD from a widget JSON schema

usage:
  gencrd [-out FILE] PATH/TO/Widget.schema.json

The CRD is validated by the apiserver's own structural check before it is written, so a
generation that succeeds cannot produce a CRD the apiserver would reject.
`)
		flag.PrintDefaults()
	}
	flag.Parse()

	if flag.NArg() != 1 {
		flag.Usage()
		// 64 is EX_USAGE. A usage error must not share an exit code with a generation failure:
		// a caller that treats any non-zero as "the schema is bad" would report the wrong thing.
		os.Exit(64)
	}

	if err := run(flag.Arg(0), *out); err != nil {
		fmt.Fprintf(os.Stderr, "gencrd: %v\n", err)
		os.Exit(1)
	}
}

func run(schemaPath, outPath string) error {
	content, err := os.ReadFile(schemaPath)
	if err != nil {
		return err
	}

	var src map[string]any
	// UseNumber so an integer bound (maxLength, minimum) survives as written rather than becoming
	// a float64 and re-marshalling as 1e+06, which the apiserver rejects for an integer field.
	dec := json.NewDecoder(strings.NewReader(string(content)))
	dec.UseNumber()
	if err := dec.Decode(&src); err != nil {
		return fmt.Errorf("%s: %w", schemaPath, err)
	}

	kind, version, err := kindAndVersion(src)
	if err != nil {
		return fmt.Errorf("%s: %w", schemaPath, err)
	}
	if kind == "" {
		return fmt.Errorf("%s: no Kind — properties.kind needs a `default`", schemaPath)
	}

	spec, err := specSchema(src)
	if err != nil {
		return fmt.Errorf("%s: %w", schemaPath, err)
	}
	if err := narrowResources(spec, declaredResources(src)); err != nil {
		return fmt.Errorf("%s: %w", schemaPath, err)
	}

	specJSON, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("%s: re-encoding the spec schema: %w", schemaPath, err)
	}

	crd, err := crdgen.Generate(crdgen.Options{
		Group:        widgetsGroup,
		Version:      version,
		Kind:         kind,
		Categories:   []string{"widgets", "krateo"},
		SpecSchema:   specJSON,
		StatusSchema: []byte(statusSchema),
	})
	if err != nil {
		return fmt.Errorf("%s: %w", schemaPath, err)
	}
	// crdgen returns the error from the apiserver's validator, so reaching here means the CRD is
	// one the apiserver accepts. An empty result would therefore be a library change, not a bad
	// schema — check it rather than writing a file that would apply as nothing.
	if len(crd) == 0 {
		return fmt.Errorf("%s: crdgen returned no error and no CRD", schemaPath)
	}

	if outPath == "" {
		base := filepath.Base(schemaPath)
		base = strings.TrimSuffix(base, filepath.Ext(base))
		outPath = filepath.Join(filepath.Dir(schemaPath), base+".crd.yaml")
	}
	if dir := filepath.Dir(outPath); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(outPath, crd, 0o644)
}
