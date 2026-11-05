package main

import "testing"

func TestPinFrom(t *testing.T) {
	const body = `components:
- name: frontend
  chart: frontend
  version: 9.9.9
- name: frontend-crd
  chart: frontend-crds
  version: 1.8.21
`
	if v, err := pinFrom([]byte(body), "frontend-crd"); err != nil || v != "1.8.21" {
		t.Errorf("got %q, %v: the entry is found by NAME, not by chart and not by position", v, err)
	}
	for name, in := range map[string]string{
		"absent":     body,
		"no-version": "components:\n- name: no-version\n",
		"not-yaml":   "\t: :",
	} {
		if v, err := pinFrom([]byte(in), name); err == nil {
			t.Errorf("%s: a pin that cannot be read must be an error, got %q", name, v)
		}
	}
}
