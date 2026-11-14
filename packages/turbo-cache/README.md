# Turbo remote cache

This package is rat-stack's declaration of [alchemy-turbo-cache](https://github.com/joelhooks/alchemy-turbo-cache/tree/a51a7ba6ea56728f89c4214befe8bf940a946e52), version `0.0.0`. The external package owns the protocol adapter, Worker, R2 bucket, generated team credentials and read-only token handoff. This package keeps only the project configuration and an adoption seam test.

## Declaration and installation

`src/index.ts` default-exports the cartridge so Alchemy loads the same declaration inside the Worker runtime. The Stack still includes it with `yield* turboCache` from `@rat-stack/turbo-cache`.

The dependency is `github:joelhooks/alchemy-turbo-cache#a51a7ba6ea56728f89c4214befe8bf940a946e52`, the commit behind tag `v0.0.0`. It is not on npm. pnpm builds its exports during Git dependency preparation. `allowBuilds.alchemy-turbo-cache` authorizes that reviewed prepare script. No tarball is vendored. A fresh install needs GitHub access as well as the existing registry access.

The configuration preserves these logical resource identities:

- `TurboCache`
- `TurboCacheFoundation/TurboCacheBucket`
- `TurboCacheFoundation/TurboCacheToken-rat-stack`

The team is `rat-stack`, retention is seven days from upload, and only stage `prod` retains resources. Reads do not extend retention; R2 lifecycle deletion is asynchronous. Changing the resource prefix or team changes identity, so inspect a production plan before deployment.

## Protocol boundary and trust

Turbo's binary artifact protocol remains an external adapter. A capability projection requires struct inputs, excludes HEAD, and cannot preserve the raw upload stream and per-artifact response headers. The package adds no application capability or alternate agent route.

R2 stores disposable CI outputs under `team/hash`. Each generated bearer authorizes only its team's prefix. A writer can replace artifacts in that team. Turbo owns signature generation and verification; the Worker preserves the signature tag. The [upstream README](https://github.com/joelhooks/alchemy-turbo-cache/blob/a51a7ba6ea56728f89c4214befe8bf940a946e52/README.md) records the routes, authentication, streaming behavior and trust limits.

## Credentials

After the desk deploys and approves the account, stage and receiver:

```sh
pnpm turbo-cache:token --team rat-stack --stage prod -- <trusted-command> [args]
```

The root script invokes the package's executable with `--stack RatStack --state-store alchemy-state-store-ratstack-state-store --prefix TurboCache --teams rat-stack`. Supply `--stage` explicitly.

The operator's secret tool injects `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. This read-only handoff uses completed Alchemy state and refuses state-store bootstrap or upgrade. Deployment authentication remains separate and uses Alchemy profiles.

Only the trusted receiver's stdin gets the token. Receiver output is suppressed. The parent prints the API origin and team slug after success. The desk owns the authorized GitHub secret write. Never paste credentials into commands, files or logs.

## Checks

Run `pnpm --filter @rat-stack/turbo-cache test`. The seam test starts the installed cartridge in local workerd, checks the exact three resource FQNs, and hands the generated credential to a subprocess that authenticates against the Worker. Upstream owns protocol property tests, the real Turbo REMOTE-hit test and token safety tests.

`apps/site/scripts/startup-report.ts` still bundles this entry through Alchemy and reports its size. Run `pnpm turbo run check test build` before shipping. Local checks do not prove live lifecycle deletion, account access or GitHub secret delivery.

## Remove the cartridge

1. Remove `yield* turboCache` and its import from `apps/infra/alchemy.run.ts`.
2. Remove this package and its workspace dependency from `apps/infra/package.json`.
3. Remove the `TurboCache` entry from `apps/site/scripts/startup-report.ts`.
4. Remove the root `turbo-cache:token` script and `allowBuilds.alchemy-turbo-cache` entry, then refresh the lockfile.
5. Remove `.brain/areas/turbo-cache.svx` and clear the GitHub cache credentials through the authorized owner.
6. Run `pnpm turbo run check test build`.

Removing a declaration does not destroy retained production resources. The desk owns any later resource deletion. See `PROVENANCE.md` for the implementation's origin.
