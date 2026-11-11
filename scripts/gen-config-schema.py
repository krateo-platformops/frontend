#!/usr/bin/env python3
"""Regenerate the `config` block of helm/frontend/values.schema.json FROM helm/frontend/values.yaml.

WHY: the krateo installer applies the values.schema.json *defaults* when it deploys a
component, so the schema — not values.yaml — is the effective source of truth for the
rendered ConfigMap. If the two drift (e.g. a stale `INIT` route), the cluster gets the
schema's value and the portal breaks. This script makes `config` a derived artifact:
its `properties` and `default` are generated verbatim from values.yaml's `config:` block.
It also writes the top-level `login` block, which has no values.yaml counterpart (see LOGIN).

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
NO_DEFAULT = {"AUTOPILOT_KOG_BUILDER_TEMPLATE", "BUILDERS_NAMESPACE"}


def prop(key: str, value: object) -> dict:
    entry = {"type": json_type(key, value), "title": title_for(key)}
    if key not in NO_DEFAULT:
        entry["default"] = value
    return entry


# The Autopilot -> Agentiko rename: every AUTOPILOT_<KEY> in values.yaml is also accepted as
# AGENTIKO_<KEY> (templates/configmap.yaml emits both, and AGENTIKO_ wins when values set it).
# The new names are typed and NEVER defaulted, for two reasons. The NO_DEFAULT one above: a schema
# default is copied into the composition spec. And precedence: a defaulted AGENTIKO_<KEY> would
# always be present, so it would beat every installer override still written under the AUTOPILOT_
# name, which is every installer today. values.yaml keeps the defaults under the old names until
# the installers have moved; then the old names, and this block, go.
DEPRECATED_PREFIX, CURRENT_PREFIX = "AUTOPILOT_", "AGENTIKO_"


def current_name(key: str) -> str:
    return CURRENT_PREFIX + key[len(DEPRECATED_PREFIX):]


def current_prop(key: str, value: object) -> dict:
    return {
        "type": json_type(key, value),
        "title": title_for(current_name(key)),
        "description": f"Agentiko name of {key}; wins over it when set. Not defaulted: an unset key falls back to {key}.",
    }


# Keys the chart DERIVES when values leave them unset, so values.yaml must not set them: any value
# there, or a schema default, would count as explicitly set and switch the derivation off. They are
# typed here (with their AGENTIKO_ twins, as above) but absent from values.yaml and never defaulted.
DERIVED = {
    "AUTOPILOT_API_BASE_URL": (
        "Unset: derived as /<agentName>, the same-origin nginx location for that Agent. Set it to "
        "override; \"\" hides the rail. With agentgateway.enabled, the gateway ORIGIN, to which the "
        "chart appends /api/a2a/<release-namespace>/<agentName>."
    ),
}

# Keys that are OFF when unset, so values.yaml leaves them unset (a commented example there documents
# each one): typed, never defaulted, absent from values.yaml. Agentiko keys added after the rename
# have only the AGENTIKO_ name, so they get no AUTOPILOT_ twin (the frontend's agentikoConfig would
# still accept one, and templates/configmap.yaml mirrors an AGENTIKO_ key to it in config.json).
OPTIONAL = {
    "AGENTIKO_RAIL_BADGE": (
        "Optional label shown as a tag in the Agentiko rail header (e.g. Staging, Preview). While it "
        "is set, the header's live/streaming pill is hidden. Unset, empty or blank: no label, and the "
        "rail is unchanged."
    ),
}

properties = {}
for key, value in config.items():
    properties[key] = prop(key, value)
for key, description in DERIVED.items():
    assert key not in config, f"{key} is derived by the chart; values.yaml must not set it"
    properties[key] = {"type": "string", "title": title_for(key), "description": description}
for key, value in [*config.items(), *((k, "") for k in DERIVED)]:
    if key.startswith(DEPRECATED_PREFIX):
        properties[current_name(key)] = current_prop(key, value)

for key, description in OPTIONAL.items():
    assert key not in config, f"{key} is off when unset; values.yaml must not set it"
    properties[key] = {"type": "string", "title": title_for(key), "description": description}

schema["properties"]["config"]["properties"] = properties
schema["properties"]["config"]["default"] = {key: value for key, value in config.items() if key not in NO_DEFAULT}

# The login-screen branding block: top-level `login`, rendered by templates/configmap.yaml as the
# "login" object of config.json (beside "api" and "params"), which the SPA reads as `config.login`
# (ui/src/context/ConfigContext.tsx). Every key is OPTIONAL in the sense above: off when unset, so
# `login` is absent from values.yaml (a commented example there documents it) and nothing here has
# a default, on the block or on any key — a default would be copied into the composition spec and
# put a "login" object into every install's config.json. Generated here, rather than hand-written in
# values.schema.json, so the drift gate also catches a default slipping in by hand.
#
# Strings are minLength 1, because the chart renders only what is set and an empty one is a mistake.
# requestAccountUrl is the href of the login screen's "Request an account" link, so it is held to an
# absolute https URL or a same-origin path: no javascript:/data: scheme, no plain http, and no
# protocol-relative `//host` or `/\host` (browsers read both as another origin). No lookahead in the
# pattern: Kubernetes validates CRD patterns with Go's RE2, which has none.
LOGIN_STRING = {"type": "string", "minLength": 1}
LOGIN = {
    "type": "object",
    "title": "Login screen",
    "description": (
        "Optional login-screen branding, rendered as the \"login\" object of config.json. Every key "
        "is optional and off when unset; config.json carries only the keys that are set, and no "
        "\"login\" object at all when none is."
    ),
    "additionalProperties": False,
    "properties": {
        "installationName": {
            **LOGIN_STRING,
            "title": "Installation name",
            "description": "This installation's name, shown on the login screen as \"to Krateo PlatformOps · <name>\".",
        },
        "requestAccountUrl": {
            **LOGIN_STRING,
            "title": "Request-account URL",
            "description": (
                "Target of the login screen's \"Request an account\" link, which is shown only when this "
                "is set: an absolute https URL, or a same-origin path starting with '/'."
            ),
            "pattern": r"^(https://[^/\\\s?#]+([/?#]\S*)?|/([^/\\\s]\S*)?)$",
        },
        "logoUrl": {
            **LOGIN_STRING,
            "title": "Logo URL",
            "description": "Login-panel logo: an absolute URL or a path the frontend serves. Unset: the bundled Krateo logo.",
        },
        "logoAlt": {**LOGIN_STRING, "title": "Logo alt text", "description": "Alt text for the logo."},
        "headline": {**LOGIN_STRING, "title": "Headline"},
        "subtitle": {**LOGIN_STRING, "title": "Subtitle"},
        "highlights": {
            "type": "array",
            "title": "Highlights",
            "description": "Up to five short lines of copy.",
            "maxItems": 5,
            "items": {**LOGIN_STRING, "maxLength": 120},
        },
    },
}


def has_default(node: object) -> bool:
    if isinstance(node, dict):
        return "default" in node or any(has_default(v) for v in node.values())
    if isinstance(node, list):
        return any(has_default(v) for v in node)
    return False


assert "login" not in values, "login is off when unset; values.yaml must not set it"
assert not has_default(LOGIN), "login must carry no schema default"
schema["properties"]["login"] = LOGIN

(CHART / "values.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
print("regenerated config schema from values.yaml:", list(config.keys()))
