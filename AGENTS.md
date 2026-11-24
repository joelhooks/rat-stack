# Agent instructions

For a non-trivial task, start with `skills/rat-stack-mode`.

This file is the repo law for agents and contributors. It holds commands, validation rules, architecture constraints, and project stop rules. Read `VISION.md` for intent before planning substantial work. `VISION.md` does not override this file. Pi sessions also load `.pi/APPEND_SYSTEM.md` and the repo-local extension `.pi/extensions/project.ts`.

Keep every root-to-leaf `AGENTS.md` chain inside Codex's default `project_doc_max_bytes` (32 KiB); `packages/core/test/agents-md-budget.test.ts` enforces it, so task-conditional material lives behind pointers.

## Stack contract

Workspace `package.json` files declare the pinned stack; [README.md](./README.md#what-is-in-the-stack) summarizes it. Keep dependencies exact; repo-local config wins; record drift, never silently migrate.

- pnpm workspaces + Turborepo (`apps/*`, `packages/*`)
- Node `>=24.18.0` and pnpm `11.3.0`; do not replace pnpm with Bun or npm for installs
- Effect `4.1.4` and `@effect/platform-node` `4.1.4`. Every Effect package resolves to one runtime. Crypto lives in `effect/crypto/*`: `SecureRandom` and `Digest` replace the removed `effect/Crypto`, and `NodeServices` no longer provides them.
- XState `6.0.0-beta.3` for finite lifecycles, retries, cancellation, and resumability
- `@xstate/effect` `1.0.0-beta.2` bridges the two: machines run as scoped Effects via `createEffectActor`, side effects are declared `createEffectLogic` actors. `vendor/README.md` keeps the rules for the next unpublished pin
- Foldkit `0.170.0` with `@foldkit/ui` and `@foldkit/devtools` `0.170.0`, `@foldkit/markdown` `0.15.0`, and `@foldkit/vite-plugin` `0.29.0` for the web UI, server-rendered and prerendered by default. Foldkit peers on `effect ~4.1.0`, so no peer allowances or patches remain.
- Alchemy `2.0.0-beta.87` (`@alchemy.run/cloudflare`, `@alchemy.run/drizzle`, `@alchemy.run/sql`) for every cloud resource; declared in `apps/infra/alchemy.run.ts`, authenticated through Alchemy profiles, never env vars. `@alchemy.run/test` `2.0.0-beta.87` runs the Worker runtime tests
- TypeScript `7.0.2` strict, patched by `@effect/tsgo` `0.69.0` in `prepare` so the Effect diagnostics in `tsconfig.base.json` fail `tsc`, not just the editor. Escape hatch for a real boundary: `// @effect-diagnostics-next-line <rule>:off` with a reason
- `@yielded/effect-tsrs` `0.2.3` runs `typecheck` and `check` (`diagnostics --project tsconfig.json --strict --type-check`: TypeScript diagnostics plus Effect warnings as failures; bundles tsrs `8f135f106a63`, in plain tsrs `0.20.0`). Keep `ignoreEffectWarningsInTscExitCode` false. Patched `tsc` runs through `typecheck:tsc` and `typecheck:parity` on checker bumps (`pnpm bump:checkers`), not every CI run. Report any checker disagreement.
- Plain tsrs `0.25.0-ts7.1.0-beta` stays in `typecheck:fast` (TypeScript `7.1.0-beta`); no Effect diagnostics, so `typecheck` or `check` still gates.
- `@effect/vitest` `4.1.4` for every Effect test: `it.effect` and `it.layer(layer)`; `Effect.run*` and `ManagedRuntime.make` in test files are a lint error
- `@oxlint/plugins` `1.93.0` for `scripts/oxlint-plugin-*.ts` and the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) rules in `tools/oxlint/anti-slop/` (generic plus Effect, at `error`); `UPSTREAM.md` covers upstream fixes
- Three MIT Landmines rules live in `tools/oxlint/landmines/`: retries and unsignaled polls fail lint; fixed sleeps and explicit timeouts warn; `pnpm check:landmines` enforces reasoned budget entries
- Oxlint `1.93.0` with Ultracite `8.2.0`, Oxfmt `0.78.0`, and Turborepo `2.11.11`
- varlock `1.25.0`: declare every env var in `.env.schema`, never read `.env.local` directly, run `pnpm env:check` after schema edits

The base Effect plugin owns diagnostic severity. Child configs may add exact `allowedUnstableApis` only for modules warned about in that scope. Do not use subtree prefixes, copy severity maps, or set `ignoreEffectWarningsInTscExitCode` to true.

## Packages

Full role notes live in `skills/rat-stack-mode/references/packages.md`.

- **`@rat-stack/catalog`** (`packages/catalog`): private monitoring Domain model; item event log is authoritative
- **`@rat-stack/catalog-server`** (`apps/catalog`): Cloudflare Worker for Catalog on Domain Durable Objects
- **`@rat-stack/capability`** (`packages/capability`): `defineContract`, `implement`, and every surface projection
- **`@rat-stack/core`** (`packages/core`): shared contracts, `inspectFile` handler and machine, `FileInspector`
- **`@rat-stack/database`** (`packages/database`): `RunLog` service and the `DatabaseVendor` choice
- **`@rat-stack/auth`** (`packages/auth`): Better Auth cartridge; `@rat-stack/auth/devtools` adds test people
- **`@rat-stack/flags`** (`packages/flags`): typed flags cartridge; ledger DO projects to KV
- **`@rat-stack/events`** (`packages/events`): capture-first request analytics behind `EVENTS_ENABLED`
- **`@rat-stack/turbo-cache`** (`packages/turbo-cache`): declaration of the Git-pinned `alchemy-turbo-cache`
- **`@rat-stack/crash`** (`packages/crash`): private crash-trace archive
- **`@rat-stack/subscriber-delivery`** (`packages/subscriber-delivery`): external subscriber intake adapter
- **`@rat-stack/learn`** (`packages/learn`): public concept deck and the learning lifecycle
- **`@rat-stack/motion`** (`packages/motion`): motion core for Foldkit apps
- **`@rat-stack/lore`** (`packages/lore`): public content graph and traversal
- **`@rat-stack/devtools`** (`packages/devtools`): 🐀 `CallLog`, `record`, and the `rat_*` capabilities
- **`@rat-stack/web`** (`apps/web`): default UI bin: Foldkit on Vite, deployed as `Website`
- **`@rat-stack/cli`** (`apps/cli`): composition root and the published `ratstack` package
- **`@rat-stack/infra`** (`apps/infra`): Alchemy Stack: the cloud footprint as one Effect program
- **`@rat-stack/site`** (`apps/site`): Cloudflare Worker: site, agent discovery, sandboxed execute

## Nouns

- **Contract** (`packages/core/src/contracts.ts`): shared name, schemas, failure, annotations, and approval setting.
- **Capability** (`packages/core/src/inspect-file.ts` or `apps/site/src/capabilities/<name>.ts`): binds one contract to its server-side handler with `implement`.
- **Projection** (`packages/capability/src/to-<surface>.ts`): exposes implemented capabilities on one runtime surface.
- **Cartridge** (`packages/<name>/src/`): one Layer with its own infrastructure; must pass the `VISION.md` cartridge test.
- **Machine** (`packages/core/src/<name>-machine.ts`): owns one finite domain lifecycle.
- **Feature** (`apps/web/src/features/<name>/`): thin route and view over the Model and Messages.
- **System page** (`.brain/areas/<name>.svx`): public `/systems/<name>` page for one shipped system: what it does, its standard, how to check; the content build rejects other shapes.
- **Client** (`apps/web/src/client/<name>/`): owns the Foldkit Model, Messages, `update`, and named Commands over the contract group.

## Commands

- **`pnpm install`**, then **`pnpm sources:fetch`** once before the first gate (pinned code objects; generation stays local-only)
- **`pnpm dev`**: `apps/web` under `vite dev` through portless at `http://rat-stack.localhost:1355`
- **`pnpm check`**: the gate (typecheck, formatting, type-aware lint); **`pnpm lint`** skips typecheck, **`pnpm fix`** rewrites, **`pnpm test`** runs Vitest once, **`pnpm build`** compiles outputs
- **`pnpm typecheck`**: strict effect-tsrs; `typecheck:tsc` runs patched `tsc` on checker bumps, `typecheck:fast` gives fast feedback with no Effect diagnostics, `typecheck:parity` compares checkers, `pnpm bump:checkers` bumps both pins (never commits)
- **`pnpm vendor:agent-sources`** / **`pnpm infra:plan|deploy|destroy`** / **`pnpm exec lefthook install`**: source mirrors, Alchemy Stack preview/apply/teardown, git hooks
- **`pnpm turbo run check test build --summarize`**: required validation before claiming a change is ready. **`pnpm turbo:summary --surface local`** prints one JSON line per `.turbo/runs/*.json` artifact (surfaces `pr`, `main`, `nightly`, `local`)

Turbo and the `alchemy-turbo-cache` cartridge are core CI/CD infrastructure: every CI build, check, and test runs through Turbo and leaves a summary (`--summarize` or `TURBO_RUN_SUMMARY=true`); PR, main, and nightly jobs publish the JSONL cache story. Only trusted CI holds the writer token; deploy, local, and agent gates take the read-only token (`pnpm turbo-cache:token --role reader`, `TURBO_CACHE=remote:r`; see `packages/turbo-cache/README.md`).

Run `pnpm fix` only when you intend to rewrite files. Finish with `pnpm turbo run check test build --summarize`.

## Deploy

Follow [ship](/skills/ship) and `skills/ship/references/project.md` for deployment commands, approval, checks, and recovery.

## Release the ratstack package

The `ratstack` npm package publishes through `.github/workflows/ratstack-publish.yml`; `skills/ship/references/ratstack-publish.md` holds the version, tag, and trusted-publishing rules.

## Fence (cheating is uncomfortable)

Why lives in `AGENTS.md` / `VISION.md`. The stack and hooks are the enforceable fence. Fence wins over prose.

- Lefthook pre-commit runs `pnpm check` and `pnpm test`. `check` runs strict effect-tsrs; floating Effects and warning-level Effect diagnostics fail. CI type-checks through `check` only.
- Agents must not use `git … --no-verify` (or equivalent hook bypass)
- Blocked by: Pi `.pi/extensions/git-interceptor`, Cursor `.cursor/hooks.json`, Claude Code `.claude/settings.json`
- Policy source: `scripts/vcs-command-policy.js`

If a hook fails, fix the failure. Do not disable the fence.

## Source-first Effect / XState work

Before writing, reviewing, or refactoring Effect or XState code, read `packages/core/node_modules/effect/AGENTS.md` first (it ships with the pinned version, so it is never stale), then the vendored sources. Populate mirrors with `pnpm vendor:agent-sources` (`--refresh` to update); refs derive from the workspace pins, and the generated `.agent_sources/README.md` holds the inventory. The `pi-effect` tool reads the Effect mirror in place.

Mirrors are reference material, not runtime dependencies: exclude them from typecheck, test, lint, and format, and do not vendor product-specific corpora in this template.

## Source control

Preserve existing work. Inspect status before editing, stage only files changed for the current task, and do not commit generated output, secrets, or populated `.agent_sources/github.com/` trees. Use the repository's existing source-control tool; do not initialize or migrate one without approval. Never pass `--no-verify` to git.

- When `.brain/data/git-snapshot.json` conflicts on a merge, run `pnpm install --frozen-lockfile`, then regenerate it with `pnpm git-snapshot`; never pick a side. Stage it with the merge commit and run the full gate; if the gate requires a post-merge refresh, add a snapshot-only follow-up with full hooks.

`.shitrat/public-allow.json` tells the ShitRat public-push guard that `.brain/` is public here, because the site is built from it. A child project owns that file: narrow or delete it the day its `.brain` holds anything not meant to be public.

## Project law

A child project replaces this section on day one with its own product rules. These rules describe the rat-stack template, not the product in a clone. Keep durable product intent in `VISION.md`.

- One contract, every surface. For Alchemy Domain models, follow the durable-state rule below: the model's Api is its contract. Elsewhere, define schemas and metadata with `defineContract`; bind a server-side handler with `implement` and add the capability to `capabilities`. CLI, HTTP, MCP, RPC, code mode, and WebMCP are projections in `packages/capability`. Never add a command, route, or tool handler that bypasses its contract.
- Schemas are the contract. Input, output, and failure are Effect `Schema`; JSON Schema, OpenAPI, and the code-mode declarations are derived from them, never hand-written.
- Durable state belongs to Alchemy Domain. State that outlives a request with rules about allowed changes lives in a Domain model; its aggregates, sagas, and atomic commits own that lifecycle, its Api is the contract, and Domain's own projections are its surfaces. A model never duplicates its aggregate in XState, and its Api never gets a second hand-rolled capability layer. Existing systems move to this rule when explicitly scoped; it does not authorize incidental migrations.
- In-process lifecycles are machines. Finite modes, retries, and cancellation inside one process live in XState machines started with `createEffectActor`; side effects live in declared `createEffectLogic` actors, never inline. Durable lifecycles follow the Alchemy Domain rule above.
- The sandbox is a surface, not a bypass. Anything reachable from a code-mode program must be a capability and goes through that capability's schemas and handler.
- Gardener rule: add a lint rule before cleaning up a bad pattern. Prefer shrinking lint baselines; growth is allowed with a one-line reason in the PR. The routine is `skills/gardener`; before simplifying or replacing a design, run `skills/uncomplect`.
- Refresh peers, versions, and tiers after every bump of Effect, Alchemy, XState, or `@xstate/effect`, and on gardener passes when a checked date is over 14 days old; report stale dates without blocking. `skills/find-peers` owns the refresh into `.brain/data/peers.json` (the content build renders `.brain/resources/peers.svx` from it; never hand-edit). Preserve every peer, show S through B with C through F collapsed, and put the rubric and full ranking atop the report.
- Tautological tests considered harmful.
- Change-detector tests considered harmful.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing.
- Prefer property and model tests over example tests. A domain rule is an `it.prop` over Effect `Arbitrary` inputs; anything with history (sessions, retries, lifecycles) is a model checked over generated command sequences. Keep example tests for seams. Plant a bug before trusting a new property: it must fail. Reference: `packages/events/test/`.
- Errors are part of the interface. Name the failure, keep its source context, say how to fix it, and fail at the boundary. Fence messages (lint, content build, startup, deploy, VCS) read `<what>. <why>. Fix: <step>` with the step naming a command, file, or replacement in a code span; `packages/core/test/fixtures/fence-message.ts` is the grammar. Build-time code references accumulate every independent failure before emitting assets; drift is a warning, never a fallback.
- `packages/code-snippets` owns the build-only excerpt pipeline and ports; `/git` and `/shiki` are adapters. Worker graphs must contain neither code-snippets nor Shiki.
- No comments in code. `no-comments/no-comments` (`scripts/oxlint-plugin-no-comments.ts`) bans them, after Lauren Tan's Dune rule: agents copy comments, and a comment that explains a workaround spreads it. Say it in a name, a type, a test, a commit message, or the Brain. Two kinds survive: tool directives with the reason inline after `--`, and a one-line `SAFETY:` invariant above a type assertion. `@ts-expect-error`, `@ts-ignore`, and `@ts-nocheck` count as directives; `typescript/ban-ts-comment` decides which may stay, so write `// @ts-expect-error -- <reason>`. `--fix` deletes prose, so move what a comment knows before running it. Plain JS keeps type-tag-only JSDoc (`@param {string} command`). Credit for borrowed code lives in `PROVENANCE.md`.
- Diagnostic overrides are targeted and explained: `// @effect-diagnostics-next-line <rule>:off -- <reason>`. File-level overrides exist only at projection boundaries (`to-toolkit.ts`, `to-code-mode.ts`, `to-rpc.ts` in `packages/capability`) and in process-spawning test files.
- Lint overrides follow the same rule: `// oxlint-disable-next-line <rule> -- <reason>`; `no-comments/directive-reason` fails a disable comment without text after `--`. `unicorn/throw-new-error` is off because `Schema.TaggedError(...)` looks like a throw. Anti-slop overrides exist only where a type is erased on purpose (the projections in `packages/capability`, the sandbox RPC boundary, the lint plugin's AST walker); anywhere else, parse the value at its boundary with Effect `Schema`.
- Hot pink is the only accent. `--accent` (#ff1493) marks borders, rules and focus rings; `--accent-text` (#c8006e, 5.7:1 on white; #ff69b4, 6.6:1 on the dark page #181825) is the only pink text, for at most one thing per screen plus focus. News chrome uses no pink. Links, headings, tables and tier cells never use it. `apps/site/test/accent.test.ts` holds the allowed selectors.
- Pins stay exact. A vendored dependency carries a matching `minimumReleaseAgeExclude` entry and a removal rule in `vendor/README.md`.

## Architecture

A child project replaces this section on day one with its own architecture. Record module boundaries, dependency direction, data ownership, and state-machine seams; link deeper docs instead of duplicating them.

- `rat-stack-boundaries/no-core-adapters` keeps provider adapters out of core. Core owns job-shaped ports; adapter packages implement them, and apps provide them at composition. `packages/subscriber-delivery` implements subscriber intake and confirmation; `packages/core/test/boundaries-rule.test.ts` checks the boundary.
- `rat-stack-boundaries/no-cross-layer-imports` enforces dependency direction: `apps/cli` → `packages/core` → `packages/capability` → Effect/XState. Packages do not import apps; `packages/capability` does not import domain code; `apps/infra` owns its Stack wiring. `core` owns shared contracts and the `inspectFile` handler; each capability's handler lives beside its data or infrastructure.
- `rat-stack-boundaries/no-browser-server-imports` (for `apps/*/src/features/**` and `client/**`) allows browser modules to import only `@rat-stack/core/contracts`, `@rat-stack/capability/rpc-group`, and `@rat-stack/capability/web-mcp`, never handler modules. `rat-stack-boundaries/no-feature-transport` applies to `apps/*/src/features/**`.
- `rat-stack-boundaries/no-hand-rolled-surface` keeps `Rpc.make`, `RpcGroup.make`, `HttpApi*`, `Tool.make`, and `Toolkit.make` inside `packages/capability`; everything else projects contracts. The same rule reserves `registerTool` for `packages/capability/src/to-web-mcp.ts`. `rat-stack-boundaries/no-browser-globals-on-server` keeps `window`, `document`, `navigator`, and web storage in `apps/*/src/client/**` and `apps/*/src/features/**`.
- `rat-stack-patterns` (`scripts/oxlint-plugin-patterns.ts`): `contract-binding-matches-name` (`const searchContract = defineContract("search", …)`), `no-module-level-mutable-state` (module `let`/`var` in `apps/*/src` and `packages/*/src` leaks across Worker requests), and `acquire-release-constructs-in-acquire-body` (build pools inside acquire, not before).
- `packages/core/src/file-inspector.ts` is the reference service shape: a `Context.Service` class whose `make` captures dependencies so its methods carry no requirements, with `static layer` beside it. `config-service.ts` derives a service from Effect `Config` (`configLayer` takes parsed values for tests); `AppConfig` mirrors `.env.schema`.
- `packages/core/src/inspect-machine.ts` is the reference shape for a lifecycle: the machine owns states, declared `createEffectLogic` actors own side effects and typed failures, `join` plus `Effect.orDie` hands the outcome back to Effect. `contracts.ts` owns `inspectFileContract`; `inspect-file.ts` implements it.
- Effect-backed machines start only under `createEffectActor`, never `createActor`. Only actions and actors declared in `setupEffect` contribute to the actor's requirements; the `xstate-effect/no-inline-effect` lint rule enforces the inline cases.
- `packages/capability/src`: `contract.ts` defines shared contracts; `implement.ts` binds typed handlers and adds approval requirements; `to-command.ts`, `to-http-api.ts`, `to-toolkit.ts`, `to-rpc.ts`, and `to-code-mode.ts` project implemented capabilities (`to-code-mode.ts` imports `to-toolkit.ts`, so MCP is a prerequisite for code mode). `to-rpc-group.ts` builds the client group and `to-rpc.ts` the server group from the same contracts; `to-web-mcp.ts` registers browser tools and dispatches through a supplied RPC client. `catalog.ts`, `sandbox-service.ts`, and `sandbox-subprocess.ts` support code mode.
- Devtools are capabilities: `devtools(capabilities)` adds the `rat_*` capabilities, and a dev composition provides recording through `devtoolsLayer()`'s `CallWatch` (`@rat-stack/capability/call-watch`). `implement` reads it inside the approval-gated handler, so denied calls record too; `aroundHandlers` stays the explicit wrapper (drovr's `writeGate`) with the gate outside the recorder. `rat_call` dispatches through `invokerFor`. Machines report through `watchActor` (`@rat-stack/capability/actor-watch`; `rat-stack-patterns/watch-effect-actors` requires it). The composition root passes `runAsPerson` from `@rat-stack/auth/devtools`, so devtools never imports auth. `rat-stack-boundaries/no-devtools-in-production` keeps devtools in `apps/*/src/dev/**`, `apps/cli`, and tests, so a deployed entry cannot reach `rat_call` or test people; `--devtools` binds `127.0.0.1` only. Plan and tool list: `.brain/archives/projects/rat-devtools.svx`.
- `apps/cli/src/surfaces.ts` and `learn-surfaces.ts` are the only places projections are instantiated; `learn-surfaces.ts` stays devtools-free because the published `ratstack` bin imports it. `command.ts` maps them to subcommands; `cli.ts` and `ratstack.ts` are the composition roots and share `learn-layer.ts`.
- The [README's Keep or cut section](./README.md#keep-or-cut) lists what to delete per surface.

## Wiki writing

Follow [write-a-wiki-page](/skills/write-a-wiki-page) for prose, visuals, code excerpts, and content-build diagnostics.

## Web feature blueprint

`apps/web/src/features/<name>/` is a thin route and view over the Model; `apps/web/src/client/<name>/` owns the Foldkit program. One send follows one path: feature → Message → `update` → named Command → `RpcClient` over the contract's `toRpcGroup` → shared capability → server-side Durable Object or database cartridge. The server stays authoritative. `apps/web/src/AGENTS.md` holds the browser rules; `/lore/a-browser-send-follows-one-path` walks a real send.

## Worker autonomy ladder

A worker acts at the lowest rung that applies. Climb only when the rung below does not cover the step.

- **0 — Do it**: Fix your own red CI, failing hook, or stale git snapshot. Arm a wait watch. Read, edit, and test inside your write scope.
- **1 — Do it and report**: Commit on your branch. Tighten a test. Edit docs or the Brain. Report what changed and which checks ran.
- **2 — Ask the desk or owner**: A choice that changes scope, a guarantee, or the design, where the repo does not decide.
- **3 — Owner sign-off**: Everything in "Needs owner sign-off" below.
- **Never — Do not do this**: `--no-verify` or any hook bypass. Merging or deploying as a worker. Force-pushing. Secrets or customer data in a PR.

At rung 2 or 3, ask one question with a recommendation. Keep doing independent work while you wait. Red CI is work, not a question: reproduce it, fix it, and push.

Never end a turn "waiting" without a wake. Procedure: `skills/rat-stack-mode/principles/own-your-wait.md`.

## Boundaries and sign-off

A child project replaces this section on day one with its own boundaries. This section names changes agents may make directly and changes that need owner approval.

- Safe by default: adding a capability in `packages/core` and wiring it into `capabilities`; new or tightened tests; a targeted diagnostic override with a written reason; README, AGENTS.md, and `.brain/` edits; tightening a lint rule; removing a surface by following Keep or cut; any change under `apps/infra`, and `pnpm infra:deploy` once `pnpm infra:plan` shows only the intended diff and the gate passes, followed by `pnpm site:smoke`.
- Needs owner sign-off: adding or changing a dependency version (pins are exact and CI installs cold); any edit to `oxlint.config.ts`, the diagnostics map in `tsconfig.base.json`, `lefthook.yml`, or `scripts/vcs-command-policy.js` that loosens the fence; `pnpm infra:destroy`, and a deploy whose plan replaces or deletes a resource; widening sandbox permissions or adding a runtime that reaches the network; exposing `serve` or `mcp` beyond localhost; vendoring a package as a `file:` tarball; deleting `.agent_sources/` or `vendor/`.
