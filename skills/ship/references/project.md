# Ship rat-stack

Read [AGENTS.md, Deploy](../../../AGENTS.md#deploy) before planning or applying.

## Commands

- `pnpm deploy:plan --profile <profile>` reads and classifies the `prod` plan.
- `pnpm deploy:prod --profile <profile> --yes` applies the approved plan and runs checks.
- `--allow '[{"resource":"Example","action":"create"}]'` grants one exact resource-action exception. It grants no other change.
- Run `pnpm turbo run check test build --concurrency=1` first.
- Keep `pnpm mischief:smoke` until typed checks pass in production.

## Authority

`ALCHEMY_PROFILE` must match the command's named profile. Provider credentials come from that profile, never environment credentials.

Missing production inputs, unreadable plans and refused permissions stop before apply. Unknown checks do not prove health. Partial apply exits with code 4 and lists completed and incomplete resources. A step crash exits with code 5.

Replacements and deletions need owner sign-off. The allow-list records that approval; it does not create authority.

## Scope

The local adapter applies the exact in-memory Alchemy plan it classified. No remote runner, canary, traffic split, automatic rollback, flags or release queue is implemented.

There is no production qualification receipt yet. Do not deploy during phase 1 implementation. Use fixtures for driver tests.

No rollback command exists. Stop after partial apply. Capture the secret-free receipt and ask the owner for an approved recovery plan.
