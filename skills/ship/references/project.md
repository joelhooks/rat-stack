# Ship rat-stack

Read [AGENTS.md, Deploy](../../../AGENTS.md#deploy) before planning or applying.

## Commands

- `pnpm deploy:plan --profile <profile>` builds all workspace outputs, then reads and classifies the `prod` plan.
- `pnpm deploy:prod --profile <profile> --yes` applies the approved plan and runs checks.
- `pnpm deploy:rollback --profile <profile> --yes` restores the prior Worker versions from the last apply receipt.
- `--receipt .rat/deploy/<profile>/last-apply.json` selects an explicit recovery receipt. Relative paths start at the repository root.
- `--allow '[{"resource":"Example","action":"create"}]'` grants one exact resource-action exception. It grants no other change.
- `--ownerApproved` records obtained owner sign-off for deletion, replacement, orphaning or unbinding. It does not obtain permission. The exact allow entry is still required.
- `--expectSha <full sha>` names the commit you mean to ship. The driver refuses to plan or apply unless `HEAD` is that commit and the tree has no changes or untracked files. The verdict records the head it saw and the changed paths.
- Run `pnpm turbo run check test build --concurrency=1` first.
- Keep `pnpm mischief:smoke` until typed checks pass in production.

## Authority

`ALCHEMY_PROFILE` must match the command's named profile. Provider credentials come from that profile, never environment credentials.

Missing production inputs, unreadable plans and refused permissions stop before apply. Unknown checks do not prove health. Partial apply exits with code 4 and lists completed and incomplete resources. A step crash exits with code 5.

Replacements and deletions need owner sign-off, recorded separately from the allow-list. Neither flag creates authority.

A refused plan stops before apply. The verdict's `resources` field names each resource that needs an allow entry or owner sign-off.

## Output

`deployPlan` and `deployProd` write the full verdict to `.rat/deploy/<profile>/verdict-<time>.json` and copy it to `last-verdict.json`. Stdout gets one JSON line with the outcome, step, reason, each check's counts and `verdictPath`. Read the file with `jq`.

- The watch verdict keeps only rejected probes. Counts hold the totals.
- Stored bodies escape control characters other than newline and tab as `\uXXXX` text.
- A failed deploy that has an apply receipt also prints the rollback command.

## Quiet windows

A quiet window is a UTC time range when `deployProd` must not apply, for example while another project deploys to the same account. Planning still runs.

- `DEPLOY_QUIET_WINDOWS` holds the windows as JSON. Empty means no windows.
- `{"start":"14:00","end":"15:30"}` repeats every day. It may cross midnight.
- `{"start":":59","end":":01"}` repeats every hour. It may cross the hour.
- Both times in one window use the same form.
- `DEPLOY_QUIET_WINDOW_MAX_WAIT_MS` sets how long the driver may wait. The default is 0, so it refuses at once. The maximum is one hour.
- The check runs after the plan passes and just before apply. Inside a window, the driver waits for its end if that end comes within the bound. Otherwise it refuses with `inside-quiet-window`.
- An invalid window list refuses with `quiet-window-config-invalid`.

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

The apply receipt records prior Worker versions and the observed prior content generation. After upload, it reads current versions from deployment history, not optional Alchemy state version IDs. Updated Workers wait for a new single-version deployment at 100 percent. Noops can retain their current version. `DEPLOY_WORKER_VERSION_DEADLINE_MS` sets the bounded settling budget; the default is 120 seconds per Worker. Readback attempts remain in the receipt. Readback exhaustion fails qualification without relabeling completed uploads as partial. The adapter saves recovery evidence before mutation. It saves the final apply receipt afterward. Local files under `.rat/deploy/` are recovery evidence, not infrastructure state.

The ten-minute watch probes both HTML and agent Accept headers.

- It reads `/sitemap.xml` first. Every cycle probes six fixed routes and a slice of the sitemap routes. The slices cover every listed route in the first third of the watch, then repeat.
- For each non-200 response it keeps the route, status, `cf-ray`, incident ID and the first 4 KB of the body. That is enough to tell a Cloudflare error page from an app error.
- Two consecutive content-500 cycles stop it early. Any observed non-200 disqualifies the watch, even if the route recovers.
- An empty sitemap or a route the watch never reached also fails it.
- Automatic rollback stays off. Recover only with `pnpm deploy:rollback`.

Rollback needs explicit capability approval. Missing, malformed or oversized receipts refuse before mutation. The selected profile must match the receipt. Each restored Worker must read back at its target version. Already restored versions cause no write. Separate rollback receipts preserve progress without replacing the source apply receipt. Missing prior content identity prevents health qualification.

No remote runner, canary, traffic split or release queue is implemented. Keep production smoke checks until the typed checks qualify the deployment.

## Read failed script uploads

If apply fails after "uploading script", read `providerErrors` in the apply receipt and verdict. The compact command report includes them too.

Each entry contains `resource`, `code` and a redacted `message`. A missing code is `null`, not the HTTP status. Missing resource metadata also stays `null`. Do not infer a provider cause from missing evidence.

The driver preserves completed resources and stops before health checks after failed apply. It excludes request headers, request bodies and unrelated response fields. Recognized credentials and private identifiers are redacted. These rules cannot identify every secret written as ordinary prose. Review messages before sharing them.

Run `pnpm --filter @rat-stack/deploy exec vitest run test/provider-failure.model.test.ts test/provider-evidence.test.ts` to check the failing-provider seam. This local proof does not reproduce a production upload error or change provider retries.

## Read escaped Worker crashes

A Cloudflare 1101 without an incident id can escape Mischief's request handler. Read the private crash archive before assigning a cause. Do not enable invocation logs or print raw trace events.

The production plan should create `MischiefCrashTail` and its retained `MischiefCrashBucket`. Mischief receives an in-place `tailConsumers` update. No Basin catalog, stream, pipeline, or additional application secret is required. The tail Worker has no public endpoint and disables its own observability. The archive runs independently of request analytics.

1. Verify Mischief's deployed `tailConsumers` names `MischiefCrashTail`'s physical Worker name.
2. Obtain the crash bucket's physical name from the plan.
3. Follow [Analytics: Read crashes without a dashboard](/systems/analytics#read-crashes-without-a-dashboard).
4. List one UTC day with at most 20 keys per page, using an R2 read-only S3 profile.
5. Fetch an exact object key. Compare its event time, route path, and script version with the failed probe.
6. Use the stack locations to investigate that version. Fix the observed cause in a separate packet.

Records keep sanitized diagnostic phrases rather than arbitrary exception text. Unknown messages and custom error names are redacted. Headers, cookies, IPs, query strings, request bodies, and console logs are excluded. Delivery is best effort; an empty listing does not establish health. Missing time, version, or route stays `null`. Replayed deliveries can create duplicate objects.

Before shipping, run the full gate and `pnpm --filter @rat-stack/events exec vitest run test/crash.test.ts`. A local passing property does not establish Cloudflare delivery. After shipping, require an actual stored failed trace before claiming the archive works. Do not add a public crash trigger to obtain that proof.

To disable crash capture, remove Mischief's tail-consumer attachment through an approved Alchemy update. Verify the deployed attachment is empty. Do not assume a code-version rollback restores script settings. Keep the retained bucket and its objects for investigation. Deleting or orphaning archive resources requires the normal plan review and owner approval.

## Local inputs

The three root deployment commands use `APP_ENV=production` with varlock. Put private application resolvers in gitignored `.env.production.local`. Keep each key declared in `.env.schema`.

- The root `.env.schema` imports `apps/mischief/.env.schema`. Varlock types and validates the Worker's keys before planning.
- The import omits the keys the root declares itself. Those keys keep the root's production requirements.
- Imported defaults reach the deploy environment. They match the Worker's code defaults.

Varlock 1.20.0 supports `KEY=exec("command that returns the value")`. A local resolver can lease an application secret without shell exports. Keep machine-specific secret names and resolver commands out of public docs and checked-in files.

```text title=".env.production.local"
ALCHEMY_PROFILE=my-profile
EXAMPLE_API_KEY=exec(`my-secret-cli read example_api_key`)
DEPLOY_QUIET_WINDOWS=[{"start":":59","end":":01"},{"start":"15:30","end":"16:30"}]
DEPLOY_QUIET_WINDOW_MAX_WAIT_MS=600000
```

- `exec()` runs the command in a shell. It removes one trailing newline from the output.
- A failed command stops before planning.
- Each deploy command resolves the values again. No wrapper script exports them.
- `varlock run` masks sensitive values in the command's output. Provider credentials still come only from the named Alchemy profile. Do not resolve provider credentials into environment variables.

Use `APP_ENV=production pnpm exec varlock load --agent` to validate local resolution without printing sensitive values. Then use the root deployment command. Missing production inputs stop before planning.
