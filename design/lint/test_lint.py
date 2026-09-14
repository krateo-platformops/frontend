#!/usr/bin/env python3
"""Self-test: every rule must fire on fixtures/violations.yaml and stay silent on clean.yaml.

Both halves matter. A check that never fires is worse than no check — it reports "clean" for a
defect it cannot see — and a check that fires on correct authoring gets deleted, taking its signal
with it. The clean fixture encodes the specific cases that made earlier drafts noisy.
"""
import importlib.util
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LINT = os.path.join(HERE, 'lint-portal-consistency.py')
def _rules():
    """Every rule the lint registers — DERIVED, never listed here.

    This was a hardcoded list of six, and the lint had grown to nine: `dead-kind`,
    `legacy-envelope` and `containment` had no self-test at all, so "6/6 rules pass" was true and
    meaningless. A test whose subject list is maintained by hand drifts from its subject exactly
    the way the widget `allowedResources` enums drifted from the registry.

    Deriving it means adding a rule without a fixture now FAILS, which is the point."""
    spec = importlib.util.spec_from_file_location('lintmod', LINT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return sorted(mod.RULES)


RULES = None  # populated in main() — the lint module is imported there


def run(target, rule):
    proc = subprocess.run(
        [sys.executable, LINT, os.path.join(HERE, 'fixtures', target), '--rule', rule, '--quiet'],
        capture_output=True, text=True, check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr



def readme_drift():
    """The README's rule table must list exactly the rules the registry registers.

    The table had drifted to seven of ten — missing `missing-target`, `containment` and
    `page-header`, two of which the design docs describe as "enforced". A reader checking that claim
    against the lint's own documentation found it absent, which is the worst possible answer: not a
    wrong rule, an apparently missing one. Documentation that can silently fall behind the code is
    the thing this whole design system exists to complain about.

    Checked in ONE direction only — registered-but-undocumented. The reverse would false-positive
    here, because this README documents the CSS lint's rules in a second table and they are not in
    this registry. An undocumented rule is the failure that actually happened; a documented rule
    that no longer exists is rarer and louder."""
    readme = os.path.join(HERE, 'README.md')
    if not os.path.isfile(readme):
        return []
    documented = set(re.findall(r'^\|\s*`([a-z-]+)`\s*\|', io.open(readme, encoding='utf-8').read(), re.M))
    return [f'{name}: registered in RULES but absent from README.md\'s rule table'
            for name in sorted(set(RULES) - documented)]



def status_body_drift():
    """Rules whose Status line reads OPEN while their body claims the work is done.

    Three real instances in one day — X3 (status doubled to `gap -> fixed -> fixed`), X4 (body
    described the fix in full while the status still said `gap`), and T2 (body said "Now enforced"
    and named the lint; status still said "the rule is not holding"). All three were written by the
    person who wrote the rule about citations drifting, within hours of writing it.

    Nobody READING those rules would have caught it: the body is long and persuasive and only a
    one-line status contradicted it. That is precisely the class of error a human review misses and
    a diff does not, so it belongs here rather than in anyone's attention.

    A status carrying an arrow (`gap -> fixed`) has already been reconciled and is skipped.
    """
    import glob
    # Tightened after a false positive: the first draft matched the bare word "shipped", which fired
    # on A1's "the shipped verbs" — ordinary prose describing what EXISTS, not a claim of completion.
    # A lint that cries wolf gets switched off, so the markers here are deliberately strong: a bold
    # status word, a DATED resolution, or the explicit "now enforced" that T2 used.
    resolved = re.compile(
        r'\*\*(RESOLVED|FIXED|SHIPPED|DONE)\*\*'
        r'|\b(now enforced|is now enforced)\b'
        r'|\b(RESOLVED|FIXED|SHIPPED)\s+20\d\d'
        r'|\bhas shipped\b',
        re.I)
    openish = re.compile(r'^(gap|open|severe|missing|partial|unenforced|breached|defect|risk|inconsistent|ungoverned)', re.I)
    out = []
    for path in sorted(glob.glob(os.path.join(HERE, '..', '0*.md'))):
        txt = open(path, encoding='utf-8').read()
        for m in re.finditer(r'^### ([TCPXAG]\d+) —.*?(?=^### |\Z)', txt, re.M | re.S):
            body, rule = m.group(0), m.group(1)
            st = re.search(r'^\*\*Status:\*\*(.*)$', body, re.M)
            if not st:
                continue
            status = re.sub(r'\*\*', '', st.group(1)).strip()
            if '\u2192' in status or '->' in status or not openish.match(status):
                continue
            if resolved.search(body):
                out.append(f'{rule}: status reads {status[:40]!r} but the body claims the work is done')
    return out


def main():
    global RULES
    RULES = _rules()
    failures = []
    for rule in RULES:
        code, out, err = run('violations.yaml', rule)
        # A CRASH IS NOT A PASS. This used to read `if code < 1`, so a rule that raised — exiting 1
        # with a traceback — was indistinguishable from one that reported a violation. X13 had been
        # crashing on this very fixture (a bare-list `resourcesRefs`, which is what X12 exists to
        # catch) and scoring green for as long as the self-test has existed.
        if 'Traceback' in err:
            failures.append(f'{rule}: CRASHED on the violations fixture\n{err.strip().splitlines()[-1]}')
        elif code < 1:
            failures.append(f'{rule}: did not fire on a real violation')
        elif not out.strip():
            failures.append(f'{rule}: exited non-zero but reported no violation line')

        code, out, err = run('clean.yaml', rule)
        if 'Traceback' in err:
            failures.append(f'{rule}: CRASHED on the clean fixture\n{err.strip().splitlines()[-1]}')
        elif code != 0:
            failures.append(f'{rule}: false positive on correct authoring\n{out}')

    # T8's key list is embedded for chart-repo runs; from THIS repo the real tokens.ts is present,
    # so assert they agree. A key added or renamed upstream without updating the lint would otherwise
    # make `colour-vocabulary` reject valid CRs — a false positive is how a rule gets switched off.
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('lintmod', LINT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        real = mod.discover_palette()
        if real and real != mod.PALETTE_KEYS:
            missing = sorted(real - mod.PALETTE_KEYS)
            extra = sorted(mod.PALETTE_KEYS - real)
            failures.append(f'palette drift: tokens.ts has {missing} not in PALETTE_KEYS; '
                            f'PALETTE_KEYS has {extra} not in tokens.ts')
    except Exception as exc:
        failures.append(f'palette drift check could not run: {exc}')

    failures.extend(f'status/body drift: {d}' for d in status_body_drift())

    for line in failures:
        print(f'FAIL {line}')
    print(f'{len(RULES) - len({f.split(":")[0] for f in failures})}/{len(RULES)} rules pass both halves')

    drift = readme_drift()
    for line in drift:
        print(f'FAIL {line}')
    if not drift:
        print(f'README documents all {len(RULES)} registered rules')
    return 1 if (failures or drift) else 0


if __name__ == '__main__':
    sys.exit(main())
