#!/usr/bin/env python3
"""Fail when a values.schema.json default disagrees with the chart's values.yaml.

core-provider rewrites an installed blueprint's CRD defaults from values.yaml wherever the schema
default differs, and flags it with SchemaDefaultsMatchValues=False. The installer also copies schema
defaults into the composition spec. So the two files must say the same thing, for every chart in helm/.

Rules, per schema node that declares a `default`:
  - values.yaml must have that key, and its value must equal the default (a schema default for a key
    values.yaml does not set is a second source of truth, so it is a disagreement too);
A schema node WITHOUT a default is always fine (typed-only keys: values.yaml supplies the value).
The `default` of an object node is compared as a whole, then its children are compared too.

USAGE: python3 scripts/lint-schema-defaults.py [chart-dir ...]   (default: every helm/*/ with a schema)
"""
import json
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
MISSING = object()


def lookup(values, path):
    node = values
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return MISSING
        node = node[part]
    return node


def walk(schema, values, path, out):
    if not isinstance(schema, dict):
        return
    if "default" in schema:
        actual = lookup(values, path)
        name = ".".join(path) or "<root>"
        if actual is MISSING:
            out.append(f"{name}: schema default {json.dumps(schema['default'])} but values.yaml has no such key")
        elif actual != schema["default"]:
            out.append(f"{name}: schema default {json.dumps(schema['default'])} != values.yaml {json.dumps(actual)}")
    for key, sub in (schema.get("properties") or {}).items():
        walk(sub, values, path + [key], out)


def check(chart: pathlib.Path):
    values = yaml.safe_load((chart / "values.yaml").read_text()) or {}
    schema = json.loads((chart / "values.schema.json").read_text())
    out = []
    walk(schema, values, [], out)
    return out


def main(argv):
    charts = [pathlib.Path(a) for a in argv] or sorted(p.parent for p in (ROOT / "helm").glob("*/values.schema.json"))
    bad = 0
    for chart in charts:
        problems = check(chart)
        for p in problems:
            print(f"{chart.name}: {p}")
        bad += len(problems)
    print(f"checked {len(charts)} chart(s): {bad} disagreement(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
