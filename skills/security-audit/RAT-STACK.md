# rat-stack audit boundaries

Use this map with Cloudflare's [security-audit skill](/skills/security-audit). It names the boundaries the stack ships. It is not an audit result.

## Capabilities and approval

[contract.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/contract.ts) declares schemas and `needsApproval`. [implement.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/implement.ts) calls `Approval.approve` before an approval-gated handler. [to-code-mode.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/to-code-mode.ts) owns invocation through input and output schemas. The `no-hand-rolled-surface` rule in [the boundary plugin](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/scripts/oxlint-plugin-boundaries.ts) restricts projection construction to the capability package.

## Code-mode sandbox

[sandbox-service.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/sandbox-service.ts) defines the sandbox service and invocation boundary. [sandbox-subprocess.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/sandbox-subprocess.ts) runs local programs in a child process with a VM context and a host-call bridge. The Worker adapter is [sandbox-worker-loader.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/apps/site/src/sandbox-worker-loader.ts). Limits are declared in [sandbox-limits.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/capability/src/sandbox-limits.ts). These are separate runtime boundaries, not a claim that a VM context is a complete security boundary.

## Better Auth and CurrentPerson

[auth.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/auth/src/auth.ts) provides Better Auth over the selected database vendor. [current-person-middleware.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/auth/src/current-person-middleware.ts) looks up a session, decodes its user id, and provides `CurrentPerson`. A missing session fails with `Unauthenticated`. This supplies identity; a handler's authorization remains a separate question.

## Devtools and production

`rat-stack-boundaries/no-devtools-in-production` in [the boundary plugin](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/scripts/oxlint-plugin-boundaries.ts) restricts devtools imports to dev compositions, CLI, and tests. [production-bundle.test.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/apps/web/test/production-bundle.test.ts) checks that dev modules and test people do not reach the production web bundle.

## Cloud resources and bindings

[alchemy.run.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/apps/infra/alchemy.run.ts) composes the Stack. Resource owners declare their own Alchemy resources and binding layers:

- Workers: [worker.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/apps/site/src/worker.ts).
- Durable Object flag ledger: [cloudflare-ledger.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/flags/src/cloudflare-ledger.ts).
- R2 crash archive: [crash-r2.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/crash/src/crash-r2.ts).
- D1 database: [d1.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/database/src/d1.ts).
- KV flag projection: [cloudflare-store.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/packages/flags/src/cloudflare-store.ts).

## Secrets and configuration

[.env.schema](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/.env.schema) declares environment variables and secret annotations. [package.json](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/package.json) runs `varlock load` in `pnpm check` and `pnpm env:check`. [AGENTS.md](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/AGENTS.md) requires variable declarations there and forbids reading `.env.local` directly. Alchemy authentication uses profiles.

## Retained resources

`rat-stack-patterns/retain-needs-stage-policy` in [the patterns plugin](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/scripts/oxlint-plugin-patterns.ts) requires a stage policy on retention calls, or a reasoned directive for shared irreplaceable resources. It guards against orphaning resources when non-production stages are destroyed. The Stack's retained resources are declared in [alchemy.run.ts](https://github.com/joelhooks/rat-stack/blob/52bf4d6809fca811bb627c2c24f5ed6c28f7d730/apps/infra/alchemy.run.ts).
