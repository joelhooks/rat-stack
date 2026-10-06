# Ship rat-stack

Read [AGENTS.md, Deploy](../../../AGENTS.md#deploy) before planning or applying.

## Commands

- `pnpm deploy:plan --profile <profile>` builds all workspace outputs, then reads and classifies the `prod` plan.
- `pnpm deploy:prod --profile <profile> --yes` applies the approved plan and runs checks.
- `pnpm deploy:rollback --profile <profile> --yes` restores the prior Worker versions from the last apply receipt.
- `--receipt .rat/deploy/<profile>/last-apply.json` selects an explicit recovery receipt. Relative paths start at the repository root.
- `--allow '[{"resource":"Example","action":"create"}]'` grants one exact resource-action exception. It grants no other change.
- `--owner-approved` records obtained owner sign-off for deletion, replacement, orphaning or unbinding. It does not obtain permission. The exact allow entry is still required.
- Run `pnpm turbo run check test build --concurrency=1` first.
- Keep `pnpm mischief:smoke` until typed checks pass in production.

## Authority

`ALCHEMY_PROFILE` must match the command's named profile. Provider credentials come from that profile, never environment credentials.

Missing production inputs, unreadable plans and refused permissions stop before apply. Unknown checks do not prove health. Partial apply exits with code 4 and lists completed and incomplete resources. A step crash exits with code 5.

Replacements and deletions need owner sign-off, recorded separately from the allow-list. Neither flag creates authority.

The classifier reads native Alchemy plan values, including bindings and tasks. It never reads terminal formatting. Alchemy confirmations use the capability approval service. Other unattended prompts fail with a typed error.

Retention protects the physical resource only. Alchemy skips physical deletion but removes the state row. The apply receipt lists confirmed retained orphans. Retention changes appear as noops and reach persisted state only on apply.

## Scope

The local adapter applies the exact in-memory Alchemy plan it classified. The prepared receipt records the expected asset generation before apply.

- Root and agent-text probes compare live ETags with that generation. Missing ETags give unknown.
- Readiness scans run at most twice. They record source time, cache fields and outcome. Scans from before apply cannot prove health.
- Content-version mismatches retry until a bounded deadline. The exported default is 120 seconds.
- Backoff starts at one second and caps at ten seconds.
- `DEPLOY_CONTENT_VERSION_DEADLINE_MS` overrides the deadline from zero through 600000 milliseconds.
- Verdicts preserve attempts, failed attempts, duration and each response's provenance.

The apply receipt records prior Worker versions and the observed prior content generation. The adapter saves recovery evidence before mutation. It saves the final apply receipt afterward. Local files under `.rat/deploy/` are recovery evidence, not infrastructure state.

The ten-minute watch probes both HTML and agent Accept headers. It preserves route, status, incident ID and at most 300 response bytes. Two consecutive content-500 cycles stop it early. Any observed non-200 disqualifies the watch, even if the route recovers. Automatic rollback stays off.

Rollback needs explicit capability approval. Missing, malformed or oversized receipts refuse before mutation. The selected profile must match the receipt. Each restored Worker must read back at its target version. Already restored versions cause no write. Separate rollback receipts preserve progress without replacing the source apply receipt. Missing prior content identity prevents health qualification.

No remote runner, canary, traffic split or release queue is implemented. Keep production smoke checks until the typed checks qualify the deployment.

## Local inputs

The three root deployment commands use `APP_ENV=production` with varlock. Put private application resolvers in gitignored `.env.production.local`. Keep each key declared in `.env.schema`.

Varlock 1.20.0 supports `KEY=exec("command that returns the value")`. A local resolver can lease an application secret without shell exports. Keep machine-specific secret names and resolver commands out of public docs and checked-in files. Provider credentials still come only from the named Alchemy profile. Do not resolve provider credentials into environment variables.

Use `APP_ENV=production pnpm exec varlock load --agent` to validate local resolution without printing sensitive values. Then use the root deployment command. Missing production inputs stop before planning.
