#!/usr/bin/env python3
"""Regenerate the `config` block of helm/frontend/values.schema.json FROM helm/frontend/values.yaml.

WHY: the krateo installer applies the values.schema.json *defaults* when it deploys a
component, so the schema — not values.yaml — is the effective source of truth for the
rendered ConfigMap. If the two drift (e.g. a stale `INIT` route), the cluster gets the
schema's value and the portal breaks. This script makes `config` a derived artifact:
its `properties` and `default` are generated verbatim from values.yaml's `config:` block.

USAGE: `python3 scripts/gen-config-schema.py`. In CI, run it then `git diff --exit-code
helm/frontend/values.schema.json` — a non-empty diff means the schema drifted from values.yaml.
"""
import json
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "frontend"

values = yaml.safe_load((CHART / "values.yaml").read_text()) or {}
schema = json.loads((CHART / "values.schema.json").read_text())

config = values.get("config", {}) or {}
existing = schema["properties"]["config"].get("properties", {})


def title_for(key: str) -> str:
    """Preserve an existing hand-written title; otherwise derive one from the key."""
    if key in existing and existing[key].get("title"):
        return existing[key]["title"]
    words = []
    for word in key.split("_"):
        words.append(word if word in ("API", "URL") else word.capitalize())
    return " ".join(words).replace("Base", "base")


# Keys pinned to a specific JSON-Schema type regardless of the values.yaml scalar.
# SNOWPLOW_IDENTITY_INJECTION MUST stay `string`: the krateo installer's config plumbing
# (chart-inspector) emits ONLY strings, and a boolean CRD field both rejects every installer value
# ("got string, want boolean") AND denies the krateofrontends v1-1-8 -> v1-2-0 composition migration
# ("expected boolean, got string"), wedging it in an infinite retry. The frontend runtime coerces
# natively (injectIdentity = !config.api.SNOWPLOW_IDENTITY_INJECTION, JS truthiness): ""/absent ->
# inject ON (legacy rollout hold-off, safe default), "true" -> inject OFF. Do NOT retype to boolean.
# See docs/frontend-1.2.0-config-type-conflict-spec-2026-07-07.md §4.
TYPE_OVERRIDES = {"SNOWPLOW_IDENTITY_INJECTION": "string"}


def json_type(key: str, value: object) -> str:
    """JSON-Schema type for a config key: a TYPE_OVERRIDES pin if present, else inferred from the
    values.yaml scalar (bool checked BEFORE int, since bool subclasses int). Inference lets a future
    typed flag render its natural type; the override is the escape hatch for keys whose stored/plumbed
    type must not follow the value (see TYPE_OVERRIDES)."""
    if key in TYPE_OVERRIDES:
        return TYPE_OVERRIDES[key]
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


# Keys added AFTER the installer began copying schema defaults into the composition CR: typed, never
# defaulted. core-provider copies a schema default into the composition spec, where it becomes a
# silent live override that freezes the value and ignores values.yaml (the 2026-09-29 Autopilot 405
# outage). Without a default, an absent key falls through to values.yaml at helm render.
NO_DEFAULT = {"AUTOPILOT_KOG_BUILDER_TEMPLATE"}


def prop(key: str, value: object) -> dict:
    entry = {"type": json_type(key, value), "title": title_for(key)}
    if key not in NO_DEFAULT:
        entry["default"] = value
    return entry


schema["properties"]["config"]["properties"] = {key: prop(key, value) for key, value in config.items()}
schema["properties"]["config"]["default"] = {key: value for key, value in config.items() if key not in NO_DEFAULT}

(CHART / "values.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
print("regenerated config schema from values.yaml:", list(config.keys()))
