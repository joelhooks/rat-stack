---
name: find-peers
description: Refresh public peers, exact stack versions, and usefulness tiers every week or two and after each shared-line bump. Study source before adopting patterns.
---

# Find peers

A peer is a public repo that shares our stack lines or a concrete stack seam. Default discovery asks for two lines; a relevant XState runtime or integration can qualify without Alchemy. Peers hit breaking changes first and write idioms before the docs do. Effect 4 remains a shared line after its stable release; drift between beta, RC, and stable is recorded, not hidden.

## Run

```sh
pnpm find-peers
```

The script reads our prerelease pins (and the Effect 4 major line when stable) from the workspace `package.json` files, searches Sourcegraph once per line, and prints a table of repos ranked by how many lines they share. Scoped packages that move with their parent, such as `@effect/vitest` with `effect`, count once. A repo missing from `.brain/data/peers.json` is marked `new`. It takes about twenty seconds. Pass `--min 1` to see repos that share only one line.

## Refresh peers, versions, and tiers

Refresh the structured rows in `.brain/data/peers.json` every week or two and after every bump of a shared line (Effect, Alchemy, XState, or `@xstate/effect`). The gardener pass owns this step; no external scheduler is required. Run discovery, add new peers, and revisit existing peers even when discovery finds nothing new.

Rat-stack's own pins are read from its root, infra, and core manifests at content-build time, so a bump changes the comparison without a hand-edited baseline. For every peer, resolve its default branch to a commit and read its actual manifests or lockfiles at that commit. Record all four lines, the checked date, and source links. Preserve exact pins; label ranges, workspace/catalog references, and missing dependencies honestly. Resolve references from the workspace catalog or lockfile where possible; never turn a range into an invented pin. Show differences beside rat-stack's pins; version drift is expected, not a reason by itself to demote a peer.

Keep every peer in `.brain/data/peers.json`, including its first-seen date, tier, one-line evidence-based reason, versions, checked date, default branch and commit, manifest/lockfile source paths, and study links. The content build reads that one dataset, sorts by tier then repository name, and renders `.brain/resources/peers.svx`: S, A, and B in the main table; C through F in a collapsed **Also seen** list. Edit structured rows, never hand-edit rendered table rows. Never delete a peer that fell behind.

## Targeted XState discovery

Run `pnpm find-peers --min 1`, then supplement Sourcegraph with GitHub code search. Search `"@xstate/effect"` across manifests and lockfiles, and `xstate alpha filename:package.json` plus `xstate "6.0.0-alpha" filename:pnpm-lock.yaml`. GitHub's token search produces false positives: an unrelated dependency may supply the alpha version. Read the actual file before counting a match.

GitHub search under an authenticated account may include private repos. Filter `repository.isPrivate` and `repository.isFork` in the results; confirm public visibility, non-fork status and no mirror via repository metadata. Exclude rat-stack itself, vendored `.repos`/`.agent_sources` trees and historical archives. A template-derived application with its own behavior is not a mirror.

Resolve the default branch (not always `main`) to a commit, read the manifests there, and resolve ranges/catalogs with that commit's lockfile. Search results are candidates, not version receipts. Keep relevant single-line seams as B; preserve explicit negative screening as C. Do not claim that no public pin exists from an empty, truncated or failed search. If a completed targeted pass finds no verified public consumer for a line, record its query, checked date and verified result count in structured search evidence and derive the dated page statement from it; recheck that evidence on the next refresh.

## Tier rubric

Tiers rank usefulness to rat-stack, not stars or exact version alignment:

- **S:** an upstream reference for our stack, or a pattern actually adopted here. Link the upstream source or adoption evidence; a recommendation alone is not an adoption.
- **A:** recently active, close to our stack, and studied with a relevant source-backed finding. Verify activity on the default branch (within the last 30 days); link the study.
- **B:** relevant shared lines or a concrete stack seam worth tailing, but not enough study/adoption evidence for A or S.
- **C:** screened with no relevant pattern for the current work. Preserve the screening evidence; revisit when our work changes.
- **D:** off-stack now, with no current relevant seam identified. State which lines or seam disappeared.
- **E:** stale (no default-branch activity for at least 90 days) and no current relevant pattern identified. Age alone does not demote a useful upstream or adopted reference.
- **F:** inaccessible or archived with no usable source-backed reference left. Record the access/archive evidence; a temporary fetch failure is unknown, not F.

C separates an explicit negative screening result from an unstudied B. D, E, and F distinguish stack mismatch, inactivity, and unusable evidence rather than pretending they are quality scores. When evidence is missing, say what is unknown and do not invent a claim. Reconsider tiers on every refresh and explain changes in the report.

Put the rubric and full ranking (peer, tier, reason, and versions) at the top of the report so Joel can give feedback after shipping. No separate approval round is required.

## Learn from the new ones

Pick at most three new peers, the ones closest to what we are building next. For each:

1. Ask DeepWiki (the `deepwiki` MCP server) one narrow question tied to current work, such as "How does this repo bind a Durable Object to an Alchemy Worker?" Treat the answer as a pointer to files.
2. Read those files at the commit that uses our versions. Adopt a pattern only after reading the code, and only when it is simpler than ours or fixes something we do wrong.
3. Record adoptions and rejections, with the reason, in `.brain/resources/same-version-repos.svx`, and link that entry from the peer's Studied column.

Stars show attention, not correctness. Do not copy a pattern because a popular repo uses it.

## Report

List the new peers, what you studied, and anything adopted. Commit the roster and notes together.
