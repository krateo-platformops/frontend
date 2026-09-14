#!/usr/bin/env python3
"""
lint-css-tokens — token-adoption checks for the Layer 1 rules in ../01-tokens.md.

THE BASELINE IS THE POINT. This codebase carried ~300 pre-existing token violations when this gate
was written (it is now seven, across five files), and a plain
gate would fail CI on its first run and be switched off within a day — which is how the last
composition lint died (23 false positives against 1 real defect, then deleted). Instead the
current state is recorded in a baseline file: CI fails on anything NOT in it, so new code is held
to the rule while the existing debt is counted, visible, and burns down.

That makes the baseline a debt ledger, not an excuse: `--summary` prints what is left per rule, and
the file shrinks as the sweep proceeds.

Usage:
    lint-css-tokens.py <dir> [--baseline FILE] [--update-baseline] [--summary] [--rule R1,R2]

Exit code is the number of NEW violations (0 = clean against the baseline).
"""
import argparse
import glob
import json
import os
import re
import sys

# A hex inside `var(--token, #888)` is a FALLBACK, not a hardcoded colour — flagging it would be a
# false positive on defensive CSS that is doing the right thing.
VAR_FALLBACK = re.compile(r'var\(\s*--[\w-]+\s*,[^)]*\)')


def css_files(root):
    return sorted(
        glob.glob(os.path.join(root, '**', '*.module.css'), recursive=True)
        + glob.glob(os.path.join(root, '**', 'index.css'), recursive=True)
    )


COMMENT = re.compile(r'/\*.*?\*/', re.S)


def _decomment(text):
    """Blank out /* ... */ while keeping every byte offset, so line numbers stay true.

    A comment is prose, not code. These files explain themselves at length — what antd does with
    `margin-bottom: 1em`, which breakpoint a cluster collapses at — and a scanner that reads prose
    reports the EXAMPLE as the violation. That is worse than a miss: the only way to satisfy it is
    to delete the explanation. Newlines are preserved so `text[:start].count("\n")` still works."""
    return COMMENT.sub(lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text)


def _read(path):
    return _decomment(open(path, encoding='utf-8').read())


def _scan(path, pattern, ok):
    """Yield (line, declaration) for every match whose value fails `ok`."""
    text = _read(path)
    for match in re.finditer(pattern, text):
        if ok(match.group(1)):
            continue
        line = text[:match.start()].count('\n') + 1
        yield line, re.sub(r'\s+', ' ', match.group(0)).strip()[:90]


# ── Which custom properties actually EXIST ──────────────────────────────────────────────────────
#
# `var(...)` used to be a blanket exemption: any font-size naming any property passed. Twenty
# declarations named `--text-body`, `--text-body-sm`, `--text-caption`, `--text-body-lg` and
# `--text-label-xs` — none of which anything defines. The shipped names carry the canonical prefix
# (`--krateo-text-body`), so every one of those declarations was invalid at computed-value time and
# the element silently inherited its parent's size instead. A gate that accepts a reference without
# checking the referent is not a gate.
#
# `--text-color` IS real and is not the same thing: it comes from the palette key `text` through
# the `--${key}-color` alias emit. That near-collision is most of why this went unnoticed.

def _object_keys(src, name):
    """Top-level keys of `export const <name> = {...}`, or of a nested `<parent>.<name>: {...}`.

    Depth-scanned rather than line-scanned: `spacing` is declared on ONE line, so a per-line parse
    finds only its first key and every `--spacing-*` then looks undefined."""
    leaf = name.split('.')[-1]
    match = re.search(rf'(?:export\s+)?const\s+{re.escape(leaf)}\s*[:=][^={{]*=?\s*{{', src)
    if not match:
        match = re.search(rf'\b{re.escape(leaf)}\s*:\s*{{', src)
    if not match:
        return []
    depth, close = 0, len(src)
    for i in range(match.end() - 1, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                close = i
                break
    body = src[match.end():close]

    keys, depth, buf = [], 0, ''
    for ch in body:
        if ch in '{[(':
            depth += 1
        elif ch in '}])':
            depth -= 1
        if depth == 0:
            if ch == ':':
                found = re.search(r"""['"]?([A-Za-z0-9_$-]+)['"]?\s*$""", buf)
                if found:
                    keys.append(found.group(1))
                buf = ''
            elif ch == ',':
                buf = ''
            else:
                buf += ch
    return keys


def known_properties(root):
    """Every custom property name this codebase defines — from CSS, and from `tokens.ts` emits."""
    names = set()

    for path in css_files(root):
        text = open(path, encoding='utf-8').read()
        names.update(re.findall(r'(--[a-z0-9-]+)\s*:', text, re.I))

    tokens = os.path.join(root, 'theme', 'tokens.ts')
    if not os.path.isfile(tokens):
        return names, False
    src = open(tokens, encoding='utf-8').read()

    # `const palette = mode === 'dark' ? colorDark : color` — resolve the local alias to both sides.
    alias = {}
    for name, a, b in re.findall(r'const\s+(\w+)\s*=\s*mode === .dark. \? (\w+) : (\w+)', src):
        alias[name] = [a, b]

    # literal emits
    names.update(re.findall(r"setProperty\(\s*'(--[a-z0-9-]+)'", src, re.I))

    # templated emits: Object.entries(SOURCE)...setProperty(`--<prefix>${key}<suffix>`
    for source, prefix, suffix in re.findall(
            r'Object\.entries\(([\w.]+)\)[^\n]*?setProperty\(\s*`--([a-z0-9-]*)\$\{key\}([a-z0-9-]*)`', src, re.I):
        for real in alias.get(source, [source]):
            for key in _object_keys(src, real):
                names.add(f'--{prefix}{key}{suffix}')
    return names, True


_KNOWN = set()
_KNOWN_READY = False


def prime_known_properties(root):
    """Populate the defined-property set once per run, before any rule scans."""
    global _KNOWN, _KNOWN_READY
    _KNOWN, _KNOWN_READY = known_properties(root)


def _var_ok(value):
    """True when every `var()` in this value names a property something actually defines.

    A `var(--x, 12px)` with a fallback is fine whatever `--x` is: it renders the fallback. A bare
    `var(--x)` naming nothing is not a token reference, it is a dead one — the declaration is
    dropped at computed-value time and the element silently inherits instead.

    Degrades to the old blanket exemption when `tokens.ts` could not be read, because a gate that
    starts reporting every token in the codebase the moment its resolver moves is worse than one
    that under-reports."""
    refs = re.findall(r'var\(\s*(--[a-z0-9-]+)\s*([,)])', value, re.I)
    if not refs:
        return False
    if not _KNOWN_READY:
        return True
    return all(has_fallback == ',' or name in _KNOWN for name, has_fallback in refs)


def rule_font_size(path):
    """T3 — every font-size resolves to a token, not a raw number.

    `1em`, `100%` and `inherit` are exempt: they declare NO size of their own, they restate the
    parent's. The markdown block in the Autopilot rail uses this to flatten h1-h6 to body size —
    a deliberate suppression of the heading ramp, not a size chosen off-scale. There is nothing
    for a token to name.

    Anything else relative (`0.85em`) is NOT exempt. It picks a size the scale does not contain,
    which is exactly what this rule exists to notice; that it does so as a ratio rather than a
    number makes it harder to see, not more legitimate."""
    return _scan(
        path, r'font-size:\s*([^;]+);',
        lambda v: _var_ok(v) or IMPORTANT.sub('', v).strip() in ('1em', '100%', 'inherit'),
    )


# `!important` is an override, not a value — stripping it before the exemption check is what keeps
# `margin: 0 !important` out of the results. It was a false positive on the first real CI run, on a
# file this very design system had just added.
IMPORTANT = re.compile(r'\s*!\s*important\s*$', re.I)


def _not_a_size(value):
    """True when every part of the value is `0` or `auto` — neither is a length.

    This was a hardcoded set of three strings ('0', 'auto', '0 auto'), which is a list of the
    cases someone happened to hit rather than a rule. `margin: auto 0` is the same statement with
    the words the other way round, and it was the last "violation" left in the codebase after the
    sweep: a declaration containing no length at all, demanding a length token."""
    return all(p in ('0', 'auto') for p in IMPORTANT.sub('', value).split())


def rule_spacing(path):
    """T4 — padding/margin resolve to --spacing-*. `0` and `auto` are not sizes.

    A NEGATIVE margin is exempt. It is not spacing — it is an offset, pulling an element out of
    the flow to meet something else: a collapsed border, a bleeding edge, or the fixed
    screen-reader-only idiom (`height: 1px; margin: -1px; clip-path: inset(50%)`), where the
    -1px is part of the pattern and snapping it to a token breaks it. Offsets answer to the thing
    they are offsetting against, not to the spacing scale."""
    return _scan(
        path, r'(?:padding|margin)[a-z-]*:\s*([^;]+);',
        lambda v: _var_ok(v) or _not_a_size(v) or re.search(r'-\d', v) is not None,
    )


def rule_gap(path):
    """T4 — gap resolves to --spacing-*."""
    return _scan(path, r'\bgap:\s*([^;]+);', lambda v: _var_ok(v) or _not_a_size(v))


def rule_hex_literal(path):
    """T1 — colour comes from a token, never a hex literal.

    A hex used as a `var()` FALLBACK is exempt: `color-mix(in srgb, var(--text-color, #888) 20%,
    transparent)` is defensive CSS doing the right thing, and flagging it teaches authors to remove
    their fallbacks."""
    text = _read(path)
    for match in re.finditer(r'^\s*([a-z-]+):\s*([^;]+);', text, re.M):
        value = match.group(2)
        stripped = VAR_FALLBACK.sub('', value)
        if re.search(r'#[0-9A-Fa-f]{3,8}\b', stripped):
            line = text[:match.start()].count('\n') + 1
            yield line, re.sub(r'\s+', ' ', match.group(0)).strip()[:90]


def rule_breakpoint(path):
    """T6 — don't invent another breakpoint.

    No breakpoint token exists yet, so this cannot say "use the token". What it CAN do is stop a
    sixth value appearing: four components already invent their own (1024/640, 1180/960, 768) and
    no two share one. Every existing value sits in the baseline; a new one fails."""
    return _scan(path, r'@media[^{]*\((?:max|min)-width:\s*([^)]+)\)', lambda v: _var_ok(v))


def rule_unguarded_animation(path):
    """T9 — a looping animation respects prefers-reduced-motion.

    File-scoped deliberately: the guard is conventionally a media block at the end of the same
    file, so cross-file analysis would buy nothing and cost precision.

    Comments are stripped BOTH sides of this one. A comment that merely mentions
    prefers-reduced-motion is not a guard, and suppressing the rule on prose would be the one
    false NEGATIVE in this file — accessibility silently unchecked because someone wrote about it."""
    text = _read(path)
    if 'prefers-reduced-motion' in text:
        return
    for match in re.finditer(r'animation:[^;]*\binfinite\b[^;]*;', text):
        line = text[:match.start()].count('\n') + 1
        yield line, re.sub(r'\s+', ' ', match.group(0)).strip()[:90]


def _themed_kinds(src):
    """Top-level component keys of `buildComponents`.

    `_object_keys` cannot read this one: buildComponents is an arrow function returning an object
    literal (`=> ({ ... })`), not `const x = {...}` or a nested `x: {...}`, so it returns [] and
    every themed widget then looks unthemed. Brace-matched from the `({` rather than line-scanned,
    because the entries nest several levels deep."""
    match = re.search(r'const\s+buildComponents\b.*?=>\s*\(\s*\{', src)
    if not match:
        return set()
    depth, close = 0, len(src)
    for i in range(match.end() - 1, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                close = i
                break
    body = src[match.end():close]
    kinds, depth = set(), 0
    for line in body.split('\n'):
        if depth == 0:
            key = re.match(r'\s{2}([A-Z]\w*)\s*:', line)
            if key:
                kinds.add(key.group(1))
        depth += line.count('{') - line.count('}')
    return kinds


WIDGET_ANTD_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'antd'")


def _imports_own_antd_kind(src, kind):
    """True if the file imports antd's component of the SAME name, aliased or not.

    `import { Alert as AntdAlert } from 'antd'` in widgets/Alert — that widget wraps antd's Alert
    and therefore CAN be themed through `buildComponents`. A composite like PageHeader imports
    `Flex, Typography` and no `PageHeader`, because antd has none; it self-styles legitimately.
    This is what separates the two populations without hardcoding a list of antd's exports, which
    would rot the moment antd adds a component."""
    for match in WIDGET_ANTD_IMPORT.finditer(src):
        for spec in match.group(1).split(','):
            name = spec.strip().split(' as ')[0].strip()
            if name == kind:
                return True
    return False


def rule_widget_theme_coverage(root):
    """T2 — a widget that wraps an antd component but has no `buildComponents` entry.

    Yields (relative_path, line, text). Repo-level rather than per-CSS-file: the question is about
    a directory listing against a TS object, and no stylesheet contains the answer.

    Deliberately silent about widgets with no antd counterpart (charts, Markdown, YamlViewer,
    PageHeader). Those are opt-outs by construction, not debt — flagging them would train readers
    to ignore the rule."""
    widgets_dir = os.path.join(root, 'widgets')
    theme = os.path.join(root, 'theme', 'tokens.ts')
    if not os.path.isdir(widgets_dir) or not os.path.exists(theme):
        return
    covered = _themed_kinds(_read(theme))
    for kind in sorted(os.listdir(widgets_dir)):
        entry = os.path.join(widgets_dir, kind, f'{kind}.tsx')
        if not os.path.exists(entry) or kind in covered:
            continue
        src = _read(entry)
        if not _imports_own_antd_kind(src, kind):
            continue
        line = 1
        for i, text in enumerate(src.split('\n'), 1):
            if "from 'antd'" in text:
                line = i
                break
        yield (os.path.relpath(entry, root), line,
               f'{kind} wraps antd {kind} but has no buildComponents entry — density is unthemed')


RULES = {
    'font-size': (rule_font_size, 'T3'),
    'spacing': (rule_spacing, 'T4'),
    'gap': (rule_gap, 'T4'),
    'hex-literal': (rule_hex_literal, 'T1'),
    'breakpoint': (rule_breakpoint, 'T6'),
    'unguarded-animation': (rule_unguarded_animation, 'T9'),
    'widget-theme-coverage': (rule_widget_theme_coverage, 'T2'),
}

# Rules that answer a repo-level question (a directory listing, a TS object) rather than scanning
# one stylesheet at a time. They take `root` and yield (relative_path, line, text) themselves.
REPO_RULES = {'widget-theme-coverage'}


def collect(root, selected):
    """{rule: {relative_path: count}} — counts, not line numbers, so the baseline survives edits
    elsewhere in a file. A file whose violations DROP is not a failure."""
    prime_known_properties(root)
    out = {}
    for name in selected:
        fn, _ = RULES[name]
        per_file = {}
        if name in REPO_RULES:
            for rel, _line, _text in fn(root):
                per_file[rel] = per_file.get(rel, 0) + 1
        else:
            for path in css_files(root):
                hits = list(fn(path))
                if hits:
                    per_file[os.path.relpath(path, root)] = len(hits)
        out[name] = per_file
    return out


def detail(root, name):
    prime_known_properties(root)
    fn, _ = RULES[name]
    if name in REPO_RULES:
        yield from fn(root)
        return
    for path in css_files(root):
        for line, text in fn(path):
            yield os.path.relpath(path, root), line, text


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('root')
    ap.add_argument('--baseline', default=None, help='JSON debt ledger (default: <script dir>/css-baseline.json)')
    ap.add_argument('--update-baseline', action='store_true')
    ap.add_argument('--summary', action='store_true', help='print the remaining debt per rule')
    ap.add_argument('--rule')
    args = ap.parse_args()

    selected = args.rule.split(',') if args.rule else list(RULES)
    for name in selected:
        if name not in RULES:
            print(f'unknown rule: {name}', file=sys.stderr)
            return 2

    baseline_path = args.baseline or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'css-baseline.json')
    current = collect(args.root, selected)

    if args.update_baseline:
        with open(baseline_path, 'w', encoding='utf-8') as fh:
            json.dump(current, fh, indent=2, sort_keys=True)
            fh.write('\n')
        total = sum(sum(f.values()) for f in current.values())
        print(f'baseline written: {baseline_path} ({total} violations recorded)')
        return 0

    baseline = {}
    if os.path.exists(baseline_path):
        baseline = json.load(open(baseline_path, encoding='utf-8'))

    if args.summary:
        print(f'{"rule":<22} {"id":<4} {"now":>6} {"baseline":>9} {"delta":>7}')
        for name in selected:
            now = sum(current.get(name, {}).values())
            was = sum(baseline.get(name, {}).values())
            flag = '' if now <= was else '  ← NEW'
            print(f'{name:<22} {RULES[name][1]:<4} {now:>6} {was:>9} {now - was:>+7}{flag}')
        return 0

    new_total = 0
    for name in selected:
        allowed = baseline.get(name, {})
        offenders = []
        for path, count in sorted(current.get(name, {}).items()):
            if count > allowed.get(path, 0):
                offenders.append((path, count, allowed.get(path, 0)))
        if not offenders:
            continue
        print(f'\n{RULES[name][1]} ({name}): {len(offenders)} file(s) above baseline')
        for path, count, was in offenders:
            over = count - was
            print(f'  {path}: {count} violations, baseline {was} — {over} NEW')
            # The baseline records per-file COUNTS, not line numbers, so that edits elsewhere in a
            # file do not invalidate it. The cost is that the specific new line cannot be named —
            # every violation in the file is listed, and the author knows which one they just wrote.
            for dpath, line, text in detail(args.root, name):
                if dpath == path:
                    print(f'      {line}: {text}')
            new_total += over

    if new_total == 0:
        print('clean against baseline')
    return new_total


if __name__ == '__main__':
    sys.exit(main())
