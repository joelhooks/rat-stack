---
name: gardener
description: Keep rat-stack current and clean. Bump the bleeding-edge pins, learn from repos on the same versions, and turn every bad pattern into a lint rule before cleaning it up.
---

# Tend the garden

Rat-stack runs on Effect 4 stable, Alchemy 2 betas, and XState 6 alphas. These lines move often. Code that other projects copy has to stay on the current line and keep getting simpler. This skill is the routine for both.

It follows Lauren Tan's gardener loop from her Dune talk: delete tech debt, keep one paved path, and lint against anti-patterns. In her words: "whenever you see tech debt or bad patterns, your instinct should be, I need to write a lint rule against it." Her ladder for where a correction should live, hardest first, is codebase, static analysis, rules, skills, style guide. This skill sits low on that ladder on purpose. Push each finding up it.

Read `AGENTS.md` first. Work in a clean clone off `origin/main`, never in a checkout with other people's uncommitted files.

## 1. Check the pins

The core pins live in the `package.json` files and in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Compare each against its current line on npm. Run registry queries outside the repo so its development-engine check does not block them:

```sh
cd /tmp
for p in effect @effect/platform-node @effect/vitest @effect/tsgo alchemy xstate @xstate/effect; do
  printf '%-24s ' "$p"; pnpm view "$p" dist-tags --json | tr -d '\n '; echo
done
```

Read the returned versions, not only the tag names. Effect 4 and its adapters now use `latest`; `rc` points to the older release candidate. Alchemy 2 and `@effect/tsgo` use `latest`. XState 6 uses `alpha`; its `latest` still points to XState 5. For `@xstate/effect`, compare both `alpha` and `latest` on the 0.1 alpha line: `latest` can be newer. Check the bridge's peer ranges before choosing the matching XState pin.

## 2. Bump one line at a time

For each line that is behind:

1. Replace the pin everywhere it appears. Effect runtime packages and adapters move together; `rg -l -F '"<old-pin>"' --glob '**/package.json'` finds both stable and prerelease pins. Keep each Effect-family bump in its own slice, separate from other dependencies and gardening. XState and its Effect bridge move together.
2. Respect the release-age policy. Replace an existing `minimumReleaseAgeExclude` entry with the new exact package version; never widen it to a package name or range. Before adding a necessary exact-version exception, inspect the registry integrity, provenance, tarball file list, package scripts, and dependency changes. Record what you checked.
3. Check peer ranges before installing: `pnpm view alchemy@<pin> peerDependencies`. Alchemy pins exact Drizzle versions and a minimum Effect; follow them.
4. Let `pnpm install` generate the lockfile; never edit it by hand. Before gating, prove freshness with `pnpm --config.optimistic-repeat-install=false install --frozen-lockfile --force`, then `pnpm peers check`; compare warnings with `origin/main`. After any dependency change, run `pnpm install --frozen-lockfile` before each gate. Keep `verifyDepsBeforeRun: error`: pnpm otherwise auto-installs during scripts. Even `--force` can skip broken YAML through the optimistic cache; `lockfile:check` disables that cache and never repairs the lock.
5. Refresh the source mirrors with `./scripts/vendor-agent-sources.sh --refresh` and update the Ref column in `.agent_sources/README.md`. Agents read the mirrors as truth, so a stale mirror teaches old APIs.
6. Read what changed upstream: `git -C .agent_sources/github.com/<owner>/<repo> log --oneline <old-tag>..<new-tag>` when the old tag is fetchable, or the package's CHANGELOG. Grep our code for every API those commits touch.
7. Update the version text in `AGENTS.md` and `README.md`. `packages/core/test/docs-pins.test.ts` fails until they match the manifests.
8. Run `pnpm turbo run check test build --force` and check its exit code.

Commit each line separately, so a regression bisects to one library.

## 3. Peers refresh

Run the `find-peers` skill every week or two and after every shared-line bump, even when there are no new peers. Read each peer's default-branch manifests or lockfiles and refresh its exact versions, checked date, tier, and evidence-based reason in `.brain/data/peers.json`. The content build reads rat-stack's current pins from its manifests and filters/sorts this one dataset into `.brain/resources/peers.svx`; do not hand-edit table rows. Drift is expected. Keep every peer: S through B in the main table, C through F in the collapsed **Also seen** list. Study relevant new peers using the skill's source-first process.

Check the dataset's oldest peer checked date on every gardener pass. If it is fourteen days old, refresh it before continuing; a shared-line bump always triggers a refresh. This repo-native pass owns the cadence, not an external scheduler. Put the rubric, full ranking, tier changes, and unresolved versions at the top of the report for feedback after shipping; no separate approval round is required.

## 4. Garden

Run `pnpm --filter @rat-stack/mischief generate`, read `.brain/data/unlinked-mentions.generated.json`, and turn useful unlinked mentions into explicit source links after checking their context; leave incidental matches alone.

Look for tech debt and patterns that should not spread: duplicated logic, a second way to do something that already has a paved path, `unknown` passed inward, dead exports, tests that assert nothing.

For each one:

1. Write the lint rule or test that fails on it first. Put a real-`oxlint` fixture test beside the other rule tests in `packages/core/test/`. Break the rule once to watch the test fail.
2. Then fix every existing instance, so the rule starts at zero findings.
3. If some findings have to stay for now, record them as a baseline that can only shrink. Never raise a baseline.
4. Delete code that nothing uses. Git keeps it.

When a pattern cannot be caught by lint, fix it in the codebase so the wrong version is hard to write. Only fall back to prose in `AGENTS.md` or a skill when neither works.

## Report

End with a short report:

- each pin moved, from and to;
- upstream changes that affected us;
- peers studied, and what was adopted or rejected;
- lint rules added, and the findings each one removed;
- anything left undone.

Vendoring apps copy these changes, so a report that says what to mirror saves them work.
