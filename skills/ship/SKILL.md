---
name: ship
description: Learn how to ship a change through merge, CI, release, stage deployment, rollout, verification, rollback and flags.
---

# Ship a change

Read `AGENTS.md` first. Use [the project mapping](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/project.md) for commands, approval boundaries, owners and evidence.

## 1. Read current capability state

<!-- deploy-confidence:start -->

Continuous deployment is off.

- Automatic production deploy: off.
- Automatic stage deploy: off.
- Automatic rollback after promotion: off.
- Automatic rollback before promotion: off.
- Provisioned canary stage: off.
- Gradual rollout: off.
- Deploy runner: local (fixture-qualified only; no production proof).

Off means unavailable for operational use, even if code or fixture tests exist.
<!-- deploy-confidence:end -->

## 2. Prepare and merge

Ship one small release per PR. Keep new behavior behind its approved flag until qualification passes.

Pin the candidate, base, observed source and infrastructure diffs, release owner and restoration target. Use fast commit checks locally. CI runs the full suite against that candidate.

Follow the project's merger ownership, protection and stack ordering. Do not bypass hooks or put approval policy in merge tooling.

### Merging

When the project uses label-free Kodiak, a ready PR merges itself once required CI is green. Open a PR only when it is meant to merge; add `NO MERGE` to hold it. Kodiak skips drafts and squash-merges eligible PRs. Real conflicts belong to the lane to fix. Read the project mapping for stack ordering and blocking labels.

WAIT[candidate-ci] owns waiting for the merged commit's CI and stage proof. A PR proof does not cover a different merged commit.

Read [CI and stage qualification](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/ci-stage.md) and [flags](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/flags.md).

## 3. Release and deploy

Read [runner selection](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/deploy-runner.md) and [deploy keys](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/deploy-key.md). Code, configuration and authorization are separate facts.

Use only capabilities marked on. When automation is off, the authorized owner follows the project's manual path.

Concurrent releases are allowed. WAIT[stage-queue] owns queue admission. Serialize deployment mutations through each stage's queue, not release preparation or verification. Latest eligible candidates supersede older queued candidates; record that outcome.

Guard each release with its own version-scoped checks. Never wait for the previous release's post-check. Require an observed plan, exact version readback and forward-compatible storage.

## 4. Roll out and verify

Read [gradual rollout](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/gradual-rollout.md), [canary](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/canary.md) and [post-deploy checks](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/post-deploy-checks.md).

Report code-ready, deployed and behavior-verified separately. Check customer-facing outcomes signed out, as the recipient would.

## 5. Restore or stop

Read [rollback](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/rollback.md) before restoration.

WAIT[release-scope] owns unresolved authorization or stage assignment. WAIT[adapter-qualification] owns missing behavioral proof. WAIT[rollback-target] owns a missing restoration target. A measured red gate follows the failure policy; HOLD does not trigger rollback.

Follow the release machine's measured-failure policy. Do not expand the approved scope to credentials, infrastructure, schema, provider writes or real-reader sends.

Follow the project's destroy refusal. Rollback promotes the previous known-good version immediately, without a rebuild or a fixed observation wait. Verify its readback. It restores code, not arbitrary data or infrastructure.

## 6. Maintain one surface

Keep this skill aligned with the deploy capabilities in the same change. Phase 1 has no release catalog or generated confidence block.

Read [catalog maintenance](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/catalog-maintenance.md) before changing capability state.

Keep this procedure and its references generic. Keep project facts behind [the project mapping](https://github.com/joelhooks/rat-stack/blob/main/skills/ship/references/project.md). Keep executable logic in the owning Effect packages and CLIs.

Skill scripts are thin launchers only. Stack and fence alignment belongs to the project's maintenance skill, not this release procedure.

Phase 1 has no waits ledger. WAIT labels above name procedure boundaries, not an implemented scheduler. Missing evidence stops deployment.
