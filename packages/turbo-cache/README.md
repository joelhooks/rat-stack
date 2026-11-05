# Turbo remote cache

This cartridge owns a Turbo-compatible Worker, a dedicated R2 bucket, and one Alchemy-generated bearer token per team. Add it to a Stack with `yield* turboCache` from `@rat-stack/turbo-cache`.

## Protocol boundary

Turbo sends binary archives through its own versioned HTTP protocol. `defineContract` requires a struct input, and its HTTP projection maps that struct to query or payload fields. Its HTTP method type excludes HEAD. It has no raw upload stream and per-artifact response-header contract. Adapting Turbo through it would change that external protocol or buffer archives into values. This Worker is an external protocol adapter, like a tail consumer or an RPC backend. It adds no application capability or alternate agent surface. No boundary lint exemption is needed.

The implementation follows Turbo [v2.11.9's API client](https://github.com/vercel/turborepo/blob/v2.11.9/crates/turborepo-api-client/src/lib.rs). It supports authenticated artifact GET, HEAD and PUT, status, event acknowledgement, and bulk metadata queries. Other method/path pairs return 404. There is no CORS preflight mode, debug endpoint, count route, populate route, or expiry override.

## Ownership and trust

- Turbo's task hash determines reuse. R2 stores a disposable copy of the archive produced by CI.
- Keys are `<team>/<hash>`. Each configured token authorizes exactly one team slug. A missing or invalid bearer gets 401. A valid bearer with an unknown or different team gets 403.
- Workers' native `crypto.subtle.timingSafeEqual` compares SHA-256 digests of the bearer and every configured token. Digest lengths are fixed. Ordinary Node does not supply that Workers extension; authentication tests run in workerd.
- A team's token can read and replace that team's artifacts. Team isolation is not isolation between writers within one team. Share tokens only with trusted CI. Neither task hashes nor this bearer prevent a trusted writer from poisoning its team's cache.
- CI on main never reads local or remote artifacts. Pull requests can read and write them. Fork pull requests receive no repository secret.
- Request and response bodies stream through the native R2 binding. They are not collected into an archive-sized buffer. `x-artifact-duration`, `x-artifact-tag` and the stored byte length survive reads. Turbo owns optional signature generation and verification; the Worker stores the signature tag unchanged.
- GET responses use `Cache-Control: no-store`. There is no edge-cache copy to invalidate. If edge caching is added, object deletion will not immediately invalidate that copy.
- R2 lifecycle expiry counts from upload, not last access. The default is seven days. Lifecycle removal is asynchronous, not an exact deletion deadline. The bucket contains cache data only.

The Worker, bucket and generated secrets retain only in `prod`. Other stages may remove them normally. A cache can be rebuilt by running tasks again.

## Configuration and credentials

Edit `src/config.ts` before deployment. Set the project repository, Stack name, state-store name, team slugs and retention days. The template team is `rat-stack`. Team slugs use letters, digits, underscores or hyphens and must be unique. Use a separate token for each team. Adding a team declares another `Alchemy.Random`; removing one revokes it on the next Worker deployment. Production state retains its generated value until the operator removes it through the normal resource workflow.

Alchemy persists each token as a `Redacted` Random attribute and binds that attribute to the Worker as a secret. The handoff reads only completed resource records. It does not evaluate the Stack, create artifact credentials, plan or deploy resources. It overrides Alchemy's state-store provisioning policy: missing or outdated stores fail closed instead of bootstrapping or upgrading during a read. Existing profile authentication remains necessary.

After the desk deploys and reviews the account, stage and receiving command:

```sh
pnpm turbo-cache:token --team rat-stack --stage prod -- <trusted-command> [args]
```

The command receives the token on stdin, without a newline. The token is never passed through argv, environment variables, files, or the parent's stdout. The receiver's stdout and stderr are discarded, even on failure. Only `TURBO_API=<origin>` and `TURBO_TEAM=<slug>` print after a successful handoff. Choose a trusted receiver that consumes stdin and safely writes the GitHub Actions secret `TURBO_TOKEN` through authorized ShitRat tooling. The desk owns that GitHub write. The script does not reach into ShitRat internals or expose installation credentials.

Set repository variables `TURBO_API` and `TURBO_TEAM` from those non-secret values. `TURBO_API` is the origin without `/v8`. `TURBO_TEAM` is a slug, not a team ID. Remote caching stays off unless both token and team are set. Turbo warns and executes the task when remote caching is unavailable. CI task failures remain failures.

## Checks

Run `pnpm --filter @rat-stack/turbo-cache test`. The local Cloudflare harness checks generated binary round trips, cross-team collisions, HEAD agreement, and auth before any storage operation. The seam test runs the pinned Turbo binary twice with distinct empty local cache directories and proves a REMOTE summary hit. Another local test starts the cartridge itself, reads its generated credential through state, and hands it to a subprocess. The stdin test hashes a synthetic credential and rejects any argv or environment copy; it also tries to echo the credential to prove receiver output is suppressed. Another test prevents state-store bootstrap and upgrade even when the caller enables provisioning. The Turbo seam also proves write-only mode ignores a warm local cache and missing credentials leave tasks executing.

CI uploads `.turbo/runs/*.json` so LOCAL and REMOTE hits can be counted separately. The nightly and manually dispatched main canary disables all cache reads. A red uncached canary alongside green cached checks is a reason to inspect task `inputs` and `env`; runner, network and test failures remain other possible causes.

Local workerd tests are not proof of deployed account access, asynchronous lifecycle expiry, or GitHub secret delivery. The desk must verify those after deployment. No deployment is part of building this package.

## Remove the cartridge

1. Delete the `yield* turboCache` line and its import in `apps/infra/alchemy.run.ts`.
2. Delete this package.
3. Delete the `@rat-stack/turbo-cache` workspace dependency in `apps/infra/package.json` and refresh the lockfile.
4. Remove the `TurboCache` entry, budget and measurement target in `apps/site/scripts/startup-budget.ts`.

Startup measurement is unconditional. A budget entry pointing at a missing cache Worker fails with a fence message that names this final removal step.

Remove the root `turbo-cache:token` script and `.brain/areas/turbo-cache.svx` as housekeeping. Clear GitHub's Turbo secret and variables. The CI env lines can stay inert, or be removed with the summary upload and nightly workflow. Run `pnpm turbo run check test build` after removal.

Removing the Stack declaration does not destroy retained production resources. The desk owns any later resource deletion. No application data or other cartridge depends on this bucket.

## Credit

The related MIT implementation is [AdiRishi/turborepo-remote-cache-cloudflare at b0aaab5c3063dd5f8d15e38e69398a0c040edcda](https://github.com/AdiRishi/turborepo-remote-cache-cloudflare/tree/b0aaab5c3063dd5f8d15e38e69398a0c040edcda). This Effect adapter is independently implemented against the pinned Turbo client. It does not copy the upstream router, cron, or storage layer. See `PROVENANCE.md`.
