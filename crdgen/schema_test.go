package main

import (
	"encoding/json"
	"testing"
)

// These cover what the generated CRDs do NOT reveal. The 44 committed CRDs are themselves a
// golden test — `crd-drift` regenerates and diffs them — so the output path is already pinned.
// What that cannot show is the behaviour on inputs the real schemas never present: a widget with
// no version, a malformed enum, an envelope asset whose shape moved. Those are the cases a future
// change will actually produce.

func TestKindAndVersionFallbackChain(t *testing.T) {
	// The chain exists because the schemas disagree: most declare `apiVersion` with a
	// group/version default and no separate `version`. Each arm is a real schema shape.
	for _, tc := range []struct {
		name            string
		props           string
		wantKind, wantV string
	}{
		{"explicit version wins", `{"kind":{"default":"Table"},"version":{"default":"v1beta1"},"apiVersion":{"default":"widgets.templates.krateo.io/v1alpha1"}}`, "Table", "v1beta1"},
		{"falls back to the apiVersion tail", `{"kind":{"default":"Table"},"apiVersion":{"default":"widgets.templates.krateo.io/v1beta1"}}`, "Table", "v1beta1"},
		{"falls back to v1alpha1 when neither is given", `{"kind":{"default":"Table"}}`, "Table", "v1alpha1"},
		// An apiVersion with no slash has no version in it. Taking the whole string would make
		// the CRD's served version "v1" for a widget group, which is wrong and would install.
		{"an apiVersion with no slash yields the default, not the whole string", `{"kind":{"default":"Table"},"apiVersion":{"default":"v1"}}`, "Table", "v1alpha1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var schema map[string]any
			if err := json.Unmarshal([]byte(`{"properties":`+tc.props+`}`), &schema); err != nil {
				t.Fatal(err)
			}
			kind, version, err := kindAndVersion(schema)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if kind != tc.wantKind || version != tc.wantV {
				t.Errorf("got (%q, %q), want (%q, %q)", kind, version, tc.wantKind, tc.wantV)
			}
		})
	}
}

func TestDeclaredResourcesRefusesAMalformedEnum(t *testing.T) {
	// A non-string enum here is a schema mistake. Reading it anyway would put nonsense into the
	// CRD's `resource` enum, which then admits nothing and fails at apply time for every CR —
	// far from the typo that caused it. Returning nothing leaves the enum un-narrowed instead,
	// which is the pre-existing behaviour for the widgets that hold no children.
	for _, tc := range []struct{ name, node string }{
		{"integer enum", `{"type":"integer","enum":[1,2]}`},
		{"no type", `{"enum":["flexes"]}`},
		{"no enum", `{"type":"string"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var schema map[string]any
			src := `{"properties":{"spec":{"properties":{"widgetData":{"properties":{"allowedResources":` + tc.node + `}}}}}}`
			if err := json.Unmarshal([]byte(src), &schema); err != nil {
				t.Fatal(err)
			}
			if got := declaredResources(schema); len(got) != 0 {
				t.Errorf("got %v, want nothing", got)
			}
		})
	}
}

func TestDeclaredResourcesReadsAStringEnum(t *testing.T) {
	var schema map[string]any
	src := `{"properties":{"spec":{"properties":{"widgetData":{"properties":{"allowedResources":{"type":"string","enum":["flexes","tables"]}}}}}}}`
	if err := json.Unmarshal([]byte(src), &schema); err != nil {
		t.Fatal(err)
	}
	got := declaredResources(schema)
	if len(got) != 2 || got[0] != "flexes" || got[1] != "tables" {
		t.Errorf("got %v, want [flexes tables]", got)
	}
}

func TestSpecSchemaDropsKindAndAPIVersionFromRequired(t *testing.T) {
	// They are required of the CR as authored, but they live on the object, not inside `spec`.
	// Requiring them within the spec schema makes every CR invalid.
	var schema map[string]any
	src := `{"properties":{"spec":{"type":"object","required":["kind","apiVersion","widgetData"],"properties":{"widgetData":{"type":"object"}}}}}`
	if err := json.Unmarshal([]byte(src), &schema); err != nil {
		t.Fatal(err)
	}
	spec, err := specSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	required, _ := spec["required"].([]any)
	if len(required) != 1 || required[0] != "widgetData" {
		t.Errorf("required = %v, want [widgetData]", required)
	}
}

func TestSpecSchemaRemovesAnEmptyRequired(t *testing.T) {
	// `required: []` is not the same as no `required`: the apiserver's structural check rejects
	// an empty array. A schema requiring ONLY kind and apiVersion would produce one.
	var schema map[string]any
	src := `{"properties":{"spec":{"type":"object","required":["kind","apiVersion"],"properties":{"widgetData":{"type":"object"}}}}}`
	if err := json.Unmarshal([]byte(src), &schema); err != nil {
		t.Fatal(err)
	}
	spec, err := specSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, present := spec["required"]; present {
		t.Errorf("required is still present as %#v; an empty one must be deleted", spec["required"])
	}
}

func TestSpecSchemaGraftsTheWholeEnvelope(t *testing.T) {
	// Six widget schemas have drifted and declare none of this; their CRDs carry it only because
	// of this graft. If an asset stops being grafted, those CRDs quietly lose shipped fields.
	var schema map[string]any
	if err := json.Unmarshal([]byte(`{"properties":{"spec":{"type":"object","properties":{}}}}`), &schema); err != nil {
		t.Fatal(err)
	}
	spec, err := specSchema(schema)
	if err != nil {
		t.Fatal(err)
	}
	props, ok := spec["properties"].(map[string]any)
	if !ok {
		t.Fatalf("spec has no properties: %#v", spec)
	}
	for _, key := range []string{apiRefKey, widgetDataTemplateKey, resourcesRefsKey, resourcesRefsTemplateKey} {
		if _, present := props[key]; !present {
			t.Errorf("%q was not grafted onto the spec schema", key)
		}
	}
}

func TestNarrowResourcesFailsLoudlyIfTheEnvelopeMoves(t *testing.T) {
	// This pins the coupling between assets/resourcesRefs.json and the path below. If that asset
	// is restructured, every container widget would silently stop having its `resource` enum
	// narrowed — so a composition naming an unrenderable kind would be admitted and fail later.
	// An error here turns that into a failed generation instead.
	spec := map[string]any{"properties": map[string]any{}}
	if err := narrowResources(spec, []string{"flexes"}); err == nil {
		t.Error("expected an error when the resourcesRefs path is absent, got nil")
	}
	// With nothing to narrow it must stay silent: most widgets hold no children.
	if err := narrowResources(spec, nil); err != nil {
		t.Errorf("no resources to narrow should be a no-op, got %v", err)
	}
}
