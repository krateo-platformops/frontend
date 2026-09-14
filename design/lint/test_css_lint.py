#!/usr/bin/env python3
"""Self-test: every rule fires on css-fixtures/violations and stays silent on css-fixtures/clean.

Both halves matter. A check that never fires reports "clean" for a defect it cannot see; a check
that fires on correct authoring gets switched off, taking its signal with it. The clean fixture
encodes the specific cases that would make this lint noisy — a hex used as a var() fallback,
`margin: 0 auto`, and an infinite animation that IS guarded.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LINT = os.path.join(HERE, 'lint-css-tokens.py')
EMPTY = os.path.join(HERE, 'css-fixtures', 'empty-baseline.json')
RULES = ['font-size', 'spacing', 'gap', 'hex-literal', 'breakpoint', 'unguarded-animation',
         'widget-theme-coverage']


def registered_rules():
    """The lint's own RULES registry, read from source.

    Without this, adding a rule to the lint and forgetting to add it here reports "6/6 rules pass"
    while the new rule is tested by nothing — which is exactly what happened when
    widget-theme-coverage landed. A self-test that silently covers less than it claims is worse
    than no self-test, because the number is reassuring."""
    src = open(LINT, encoding='utf-8').read()
    block = re.search(r'^RULES = \{(.*?)^\}', src, re.S | re.M)
    return set(re.findall(r"^\s*'([\w-]+)':", block.group(1), re.M)) if block else set()


def run(fixture, rule):
    proc = subprocess.run(
        [sys.executable, LINT, os.path.join(HERE, 'css-fixtures', fixture),
         '--rule', rule, '--baseline', EMPTY],
        capture_output=True, text=True, check=False,
    )
    return proc.returncode, proc.stdout


def main():
    with open(EMPTY, 'w', encoding='utf-8') as fh:
        fh.write('{}\n')
    failures = []
    registered = registered_rules()
    untested = registered - set(RULES)
    unregistered = set(RULES) - registered
    if untested:
        failures.append(f'registry: {sorted(untested)} registered in the lint but not tested here')
    if unregistered:
        failures.append(f'registry: {sorted(unregistered)} tested here but not registered in the lint')

    for rule in RULES:
        code, _ = run('violations', rule)
        if code < 1:
            failures.append(f'{rule}: did not fire on a real violation')
        code, out = run('clean', rule)
        if code != 0:
            failures.append(f'{rule}: false positive on correct authoring\n{out}')
    os.remove(EMPTY)

    for line in failures:
        print(f'FAIL {line}')
    passed = len(RULES) - len({f.split(':')[0] for f in failures})
    print(f'{passed}/{len(RULES)} rules pass both halves')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
