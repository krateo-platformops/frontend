#!/usr/bin/env python3
"""
The gate's secrets rule (src/pages/secrets.ts) against THE PORTAL'S OWN lint and defs:

1. Every case in cases.json is judged by krateo-platformops/portal scripts/lint-ra-secrets.py (at
   the commit in PORTAL_REF, fetched by CI) exactly as that lint judges a rendered RESTAction step,
   and must match the verdict the case records — the same verdict secrets.test.ts asserts for the
   TypeScript port. A case marked `portalGap` is one the gate refuses and that portal commit still
   ACCEPTS (a bypass the review of #446 found; the portal lint is being fixed separately): the
   portal lint must accept it there, so the day it is fixed this fails and the mark is removed.
2. src/pages/fetchableDefs.json — the defs the gate requires VERBATIM — must equal the
   portal.fetchableDefs define in helm/portal/templates/_fetchable.tpl at the same commit.

Usage: conformance.py <lint-ra-secrets.py> <_fetchable.tpl>
"""
import importlib.util
import json
import os
import re
import sys

spec = importlib.util.spec_from_file_location('lint', sys.argv[1])
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)

HERE = os.path.dirname(os.path.abspath(__file__))
failures = 0
for case in json.load(open(os.path.join(HERE, 'cases.json'))):
    step = case['step']
    hits = [k for k, v in lint.step_fields(step).items() if lint.names_secrets(v)]
    if not hits and lint.data_driven(step):
        ok, _ = lint.guarded(step)
        hits = [] if ok else ['data-driven']
    refused = bool(hits)
    expected = (not case['refused']) if case.get('portalGap') else case['refused']
    mark = 'ok  ' if refused == expected else 'FAIL'
    failures += refused != expected
    gap = ' (portalGap: the gate refuses it; this portal commit does not)' if case.get('portalGap') else ''
    print(f"{mark} {case['name']}: portal lint {'refuses' if refused else 'accepts'}{gap}")

tpl = open(sys.argv[2], encoding='utf-8').read()
m = re.search(r'\{\{- define "portal.fetchableDefs" -\}\}\n(.*?)\n\{\{- end -\}\}', tpl, re.S)
pinned = json.load(open(os.path.join(HERE, '..', '..', 'src', 'pages', 'fetchableDefs.json')))['defs']
same = bool(m) and ' '.join(m.group(1).split()) == ' '.join(pinned.split())
print(f"{'ok  ' if same else 'FAIL'} src/pages/fetchableDefs.json equals portal.fetchableDefs in _fetchable.tpl")
failures += not same
sys.exit(1 if failures else 0)
