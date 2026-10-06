# Ship rat-stack

Read [AGENTS.md, Deploy](../../../AGENTS.md#deploy) before planning or applying.

## Commands

- `pnpm deploy:plan --profile <profile>` builds all workspace outputs, then reads and classifies the `prod` plan.
- `pnpm deploy:prod --profile <profile> --yes` applies the approved plan and runs checks.
- `--allow '[{"resource":"Example","action":"create"}]'` grants one exact resource-action exception. It grants no other change.
- `--owner-approved` records obtained owner sign-off for deletion, replacement, orphaning or unbinding. It does not obtain permission. The exact allow entry is still required.
- Run `pnpm turbo run check test build --concurrency=1` first.
- Keep `pnpm mischief:smoke` until typed checks pass in production.

## Authority

`ALCHEMY_PROFILE` must match the command's named profile. Provider credentials come from that profile, never environment credentials.

Missing production inputs, unreadable plans and refused permissions stop before apply. Unknown checks do not prove health. Partial apply exits with code 4 and lists completed and incomplete resources. A step crash exits with code 5.

Replacements and deletions need owner sign-off, recorded separately from the allow-list. Neither flag creates authority.

The classifier reads native Alchemy plan values, including bindings and tasks. It never reads terminal formatting. Alchemy confirmations use the capability approval service. Other unattended prompts fail with a typed error.

Retention is a physical-resource backstop, not a delete guard. Alchemy skips physical deletion but removes the state row. The apply receipt lists confirmed retained orphans. Retention changes appear as noops and reach persisted state only on apply.

## Scope

The local adapter applies the exact in-memory Alchemy plan it classified. The prepared receipt records the expected asset generation before apply. Root and agent-text probes compare live ETags with that generation. Missing ETags give unknown. Each readiness scan attempt records its source time, cache fields and outcome; scans from before apply cannot prove health. There is one retry, not an unbounded settle loop.

The apply receipt records prior live Worker version IDs for approved recovery. No remote runner, canary, traffic split, automatic rollback, flags or release queue is implemented.

There is no production qualification receipt yet. Do not deploy during phase 1 implementation. Use fixtures for driver tests.

No rollback command exists. Stop after partial apply. Capture the secret-free receipt and ask the owner for an approved recovery plan.
