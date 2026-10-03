#!/usr/bin/env python3
"""
The gate's secrets rule (src/pages/secrets.ts) against THE PORTAL'S OWN lint: every case in
cases.json is judged by krateo-platformops/portal scripts/lint-ra-secrets.py (at the commit in
PORTAL_REF, fetched by CI) exactly as that lint judges a rendered RESTAction step, and must match
the verdict the case records — the same verdict secrets.test.ts asserts for the TypeScript port.

Usage: conformance.py <path to lint-ra-secrets.py>
"""
import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location('lint', sys.argv[1])
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)

failures = 0
for case in json.load(open(os.path.join(os.path.dirname(__file__), 'cases.json'))):
    step = case['step']
    hits = [k for k, v in lint.step_fields(step).items() if lint.names_secrets(v)]
    if not hits and lint.data_driven(step):
        ok, _ = lint.guarded(step)
        hits = [] if ok else ['data-driven']
    refused = bool(hits)
    mark = 'ok  ' if refused == case['refused'] else 'FAIL'
    failures += refused != case['refused']
    print(f"{mark} {case['name']}: portal lint {'refuses' if refused else 'accepts'}, case says {'refused' if case['refused'] else 'accepted'}")
sys.exit(1 if failures else 0)
