package main

import (
	"fmt"

	"sigs.k8s.io/yaml"
)

// pinFrom reads one component's version out of installer's component-pins.yaml. Split from the
// fetch so it is testable offline: the pin name and the chart name differ (`frontend-crd` pins
// chart `frontend-crds`), which is the mistake this parsing exists to not make.
func pinFrom(body []byte, name string) (string, error) {
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
		if c.Name == name {
			if c.Version == "" {
				return "", fmt.Errorf("the %s pin entry carries no version", name)
			}
			return c.Version, nil
		}
	}
	return "", fmt.Errorf("no .components[] entry named %s in %d pins", name, len(pins.Components))
}
