#!/usr/bin/env python3
"""
The gate's secrets rule (src/pages/secrets.ts) against THE PORTAL'S OWN lint and defs, at the
portal commit in PORTAL_REF (CI fetches both files into a portal-shaped tree):

1. The portal lint's own self-test passes (its PLANTED bypasses caught, its CLEAN shapes accepted).
2. cases.json carries every one of the portal's PLANTED and CLEAN steps, verbatim.
3. Every case in cases.json gets, from the portal's check_step, exactly the verdict the case
   records — the same verdict secrets.test.ts asserts for the TypeScript port. No case may be
   marked as a known disagreement: the two engines agree on all of them.
4. src/pages/fetchableDefs.json — the defs the gate requires verbatim — equals portal.fetchableDefs
   in _fetchable.tpl, whitespace-normalized.

Usage: conformance.py <portal tree with scripts/lint-ra-secrets.py and helm/portal/templates/_fetchable.tpl>
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('lint', os.path.join(sys.argv[1], 'scripts', 'lint-ra-secrets.py'))
lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lint)

failures = lint.self_test()
for f in failures:
    print(f'FAIL {f}')

cases = json.load(open(os.path.join(HERE, 'cases.json'), encoding='utf-8'))
steps = [c['step'] for c in cases]
for kind, entries in (('PLANTED', lint.PLANTED), ('CLEAN', lint.CLEAN)):
    for what, step in entries:
        if step not in steps:
            failures.append(f'portal {kind} {what!r} is missing from cases.json')
            print(f'FAIL portal {kind} {what!r} is missing from cases.json')

for case in cases:
    if 'portalGap' in case:
        failures.append(f"{case['name']}: marked portalGap — the engines must agree on every case")
    refused = bool(lint.check_step(case['step']))
    ok = refused == case['refused']
    failures += [] if ok else [case['name']]
    print(f"{'ok  ' if ok else 'FAIL'} {case['name']}: portal lint {'refuses' if refused else 'accepts'}")

pinned = json.load(open(os.path.join(HERE, '..', '..', 'src', 'pages', 'fetchableDefs.json'), encoding='utf-8'))['defs']
same = lint.normalized(pinned) == lint.CANONICAL
print(f"{'ok  ' if same else 'FAIL'} src/pages/fetchableDefs.json equals portal.fetchableDefs in _fetchable.tpl")
failures += [] if same else ['fetchableDefs.json']
print(f'{len(cases)} cases, {len(failures)} failure(s)')
sys.exit(1 if failures else 0)
