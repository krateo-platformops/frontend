---
type: Architecture
title: frontend — the Evidence panel's GitHub org is a guess
description: Why an Evidence row's repo link derives the GitHub org from the repository NAME, what it gets wrong, and the two-line change in repo-mcp-server that would remove the guess.
resource: ghcr.io/krateo-platformops/frontend
tags: [autopilot, evidence, grounding, known-gap, records]
timestamp: 2026-08-25T00:00:00Z
---

# The Evidence panel's GitHub org is a guess

**Status: known gap, deliberate.** Recorded 2026-08-25 with the Evidence panel
(`src/components/Autopilot/evidence.ts`, `orgOfRepo`). Re-verify against the code before relying
on any line here.

## What the panel shows, and what it does not know

An Evidence row for a repo lookup renders the file the agent read, linked to that file at the ref
it was read at:

```
read_repo_file   krateo-platformops/core-provider @ 2.13.4
                 helm/core-provider/templates/deployment.yaml ↗
→ https://github.com/krateo-platformops/core-provider/blob/2.13.4/helm/core-provider/templates/deployment.yaml#L1-L134
```

Every part of that URL comes from the wire **except the org**:

| part | source |
|---|---|
| `core-provider` | the tool call's `args.repo` |
| `helm/…/deployment.yaml` | the tool call's `args.path` |
| `2.13.4` | the result's provenance header, `# <repo> @ <ref> — …` |
| `#L1-L134` | the result's second header line, `# <repo>/<path> — lines X-Y of Z` |
| **`krateo-platformops`** | **guessed from the repository name** |

No repo-mcp-server tool reports the org — not in the arguments, not in the provenance header, not
in `list_repos`/`list_blueprints` output. The server knows it (`corpus.org_of()` is the effective
allow-list) and never says it.

## The guess

`orgOfRepo` mirrors repo-mcp-server's three corpus tiers by name shape:

| shape | org |
|---|---|
| `krateo-autopilot`, `codegen-agents` | `krateo-agentiko` |
| contains `blueprint`, ends `-kog` / `-kog-chart`, starts `openstack-` | `krateo-blueprints` |
| anything else | `krateo-platformops` |

Checked against the whole corpus (`mcp-servers/repo-mcp-server/corpus.py` in
`krateo-agentiko/autopilot`) on 2026-08-25: correct for every entry except **`krateo-acmp`**, an
umbrella tracking repo, which the fallback sends to `krateo-platformops` instead of
`krateo-blueprints`.

**Blast radius of a wrong guess: one dead link.** Nothing else reads `source.org` — the row still
names the repo, ref and path, and the rest of the panel is unaffected. The rendered org is visible
in the row, so a reader can see what was assumed.

**How it rots:** silently. A new blueprint or agentiko repo whose name fits none of those shapes
gets a `krateo-platformops` link that 404s, and only a human clicking it finds out. Nothing in CI
compares this table to the corpus.

## The fix, whenever it is wanted

Have repo-mcp-server state the org it already resolved. `_candidates()` in
`mcp-servers/repo-mcp-server/repo_tools.py` computes `org = corpus.org_of(repo)` at the top and
then builds provenance strings that drop it — so org-prefixing those strings is the whole change:

```python
# repo_tools.py, _candidates() — provenance strings, e.g.
f"{repo} @ {version} — this server's default version for this repository."
# becomes
f"{org}/{repo} @ {version} — this server's default version for this repository."
```

Then, on this side:

- `readProvenance`'s ref regex already tolerates it (`^#\s*\S+\s+@\s+(\S+)` matches
  `krateo-platformops/core-provider @ 2.13.4`), so links keep working during the rollout;
- capture the org from that same match and **delete `orgOfRepo`** plus its test case, rather than
  keeping both a header value and a guess;
- while both server versions are in the fleet, keep the fallback for a header with no `/`.

It also gives the model a citable org, which the "Verify before you assert" prompt rule currently
has no way to state.
