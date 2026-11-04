package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/krateo-platformops/plumbing/maps"
)

// THE ENVELOPE EVERY WIDGET CARRIES, and the reason it is a file rather than a schema fragment.
//
// `apiRef`, `widgetDataTemplate`, `resourcesRefs` and `resourcesRefsTemplate` are the same on
// every widget: they are how a widget names its data source, templates its own data, and declares
// the objects it reads or writes. No widget schema spells them out, and these files are grafted
// onto each one before generation.
//
// THAT GRAFT IS LOAD-BEARING, NOT A CONVENIENCE. Six widget schemas have drifted and no longer
// declare the per-item `payload`/`slice` fields (Breadcrumb, Filters, Layout, Listy) or `slice`
// (Flex, Upload), and none declares a top-level `resourcesRefs.slice`. Their CRDs carry those
// fields ONLY because this asset is substituted wholesale. Generating purely from the schemas
// would silently DELETE shipped fields from live CRDs.
//
// The rule that follows, for anyone editing these: add what a schema omits, never overwrite what
// it declares. And when a schema drifts from this envelope, fix the schema — do not quietly widen
// the envelope to cover it, because then the drift stops being visible anywhere.
//
//go:embed assets/apiRef.json assets/widgetDataTemplate.json assets/resourcesRefs.json assets/resourcesRefsTemplate.json
var envelope embed.FS

const (
	apiRefKey                = "apiRef"
	widgetDataKey            = "widgetData"
	widgetDataTemplateKey    = "widgetDataTemplate"
	resourcesRefsKey         = "resourcesRefs"
	resourcesRefsTemplateKey = "resourcesRefsTemplate"
	allowedResourcesKey      = "allowedResources"
)

// kindAndVersion reads the Kind and the API version a widget declares, from the `default` of its
// own `kind`/`version`/`apiVersion` properties.
//
// The fallback chain is `version`, then the tail of `apiVersion`, then `v1alpha1`. It is written
// as a chain rather than one required field because the schemas disagree: most carry `apiVersion`
// with a `group/version` default and no separate `version`.
func kindAndVersion(schema map[string]any) (kind, version string, err error) {
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		return "", "", fmt.Errorf("missing 'properties' field")
	}

	deflt := func(key string) string {
		prop, ok := properties[key].(map[string]any)
		if !ok {
			return ""
		}
		s, _ := prop["default"].(string)
		return s
	}

	kind = deflt("kind")
	version = deflt("version")
	if version == "" {
		apiVersion := deflt("apiVersion")
		if idx := strings.LastIndexByte(apiVersion, '/'); idx > 0 {
			version = apiVersion[idx+1:]
		}
	}
	if version == "" {
		version = "v1alpha1"
	}
	return kind, version, nil
}

// declaredResources returns the resource plurals a container widget says it may hold, read from
// the enum on `spec.widgetData.allowedResources`.
//
// Absent is not an error: most widgets hold no children, and for those the enum below is simply
// not narrowed. Returning an empty slice rather than an error is what makes that the normal case.
func declaredResources(schema map[string]any) []string {
	node, ok, _ := maps.NestedMap(schema,
		"properties", "spec", "properties", widgetDataKey, "properties", allowedResourcesKey)
	if !ok {
		return nil
	}

	// Only a string enum. A non-string enum here would be a schema error, and silently reading
	// it as resource names would put nonsense in the CRD rather than surfacing the mistake.
	if t, _ := node["type"].(string); t != "string" {
		return nil
	}
	vals, ok := node["enum"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// specSchema lifts `properties.spec` and grafts the envelope onto it.
//
// `kind` and `apiVersion` are dropped from `required`: they are required of a widget CR as
// authored, but the CRD's own `spec` schema must not require them — they live on the object, not
// inside `spec`, and requiring them there makes every CR invalid.
func specSchema(in map[string]any) (map[string]any, error) {
	spec, ok, err := maps.NestedMap(in, "properties", "spec")
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("properties.spec not found in JSON schema")
	}

	for _, key := range []string{apiRefKey, widgetDataTemplateKey, resourcesRefsKey, resourcesRefsTemplateKey} {
		if err := graft(key, spec); err != nil {
			return nil, err
		}
	}

	if required, ok := spec["required"].([]any); ok {
		kept := make([]any, 0, len(required))
		for _, v := range required {
			if s, ok := v.(string); ok && (s == "kind" || s == "apiVersion") {
				continue
			}
			kept = append(kept, v)
		}
		// nil rather than an empty slice when nothing survives: `required: []` is not the same
		// as no `required`, and an empty array is rejected by the apiserver's structural check.
		if len(kept) == 0 {
			delete(spec, "required")
		} else {
			spec["required"] = kept
		}
	}

	return spec, nil
}

// narrowResources restricts `resourcesRefs[].items[].resource` to the plurals the widget declares.
//
// Without this every container accepts any resource name, so a composition naming a kind the
// widget cannot render is admitted and fails at render time instead of at apply time.
func narrowResources(spec map[string]any, resources []string) error {
	if len(resources) == 0 {
		return nil
	}

	path := []string{"properties", resourcesRefsKey, "properties", "items", "items", "properties", "resource"}
	node, ok, err := maps.NestedMap(spec, path...)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%q not found in the grafted envelope", strings.Join(path, "."))
	}

	node["enum"] = resources
	return maps.SetNestedValue(spec, path, node)
}

func graft(key string, into map[string]any) error {
	data, err := envelope.ReadFile(fmt.Sprintf("assets/%s.json", key))
	if err != nil {
		return err
	}
	var sub map[string]any
	if err := json.Unmarshal(data, &sub); err != nil {
		return fmt.Errorf("asset %s.json is not valid JSON: %w", key, err)
	}
	return maps.SetNestedField(into, sub, "properties", key)
}
