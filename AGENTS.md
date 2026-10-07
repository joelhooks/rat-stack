# Agent instructions

For a non-trivial task, start with `skills/rat-stack-mode`.

This file is the repo law for agents and contributors. It holds commands, validation rules, architecture constraints, and project stop rules. Read `VISION.md` for intent before planning substantial work. `VISION.md` does not override this file. Pi sessions also load `.pi/APPEND_SYSTEM.md` and the repo-local extension `.pi/extensions/project.ts`.

## Stack contract

Workspace `package.json` files declare the pinned stack. [README.md](./README.md#what-is-in-the-stack) summarizes it. Keep dependencies exact. Repo-local config wins. Record drift instead of silently migrating the project.

- pnpm workspaces + Turborepo (`apps/*`, `packages/*`)
- Node `>=24.18.0` and pnpm `11.3.0`; do not replace pnpm with Bun or npm for installs
- Effect `4.0.0` and `@effect/platform-node` `4.0.0`
- XState `6.0.0-alpha.63` for finite lifecycles, retries, cancellation, and resumability
- `@xstate/effect` `0.1.0-alpha.6` bridges the two: machines run as scoped Effects via `createEffectActor`, side effects are declared `fromEffect` actors. This pin was published to npm 2026-10-01; `vendor/README.md` keeps the rules for the next unpublished pin
- Alchemy `2.0.0-beta.80` (Infrastructure as Effects) for every cloud resource; declared in `apps/infra/alchemy.run.ts`, authenticated through Alchemy profiles, never through env vars in this repo
- TypeScript `7.0.2` in strict mode, patched by `@effect/tsgo` `0.45.0` in `prepare` so the Effect language service diagnostics in `tsconfig.base.json` fail `tsc`, not just the editor. Escape hatch for a real boundary: `// @effect-diagnostics-next-line <rule>:off` with a reason
- `@effect/vitest` `4.0.0` for every Effect test: `it.effect` and `it.layer(layer)`; `Effect.run*` and `ManagedRuntime.make` in test files are a lint error
- `@oxlint/plugins` `1.83.0` for the two typed lint rules in `scripts/oxlint-plugin-*.ts` and the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) rules in `tools/oxlint/anti-slop/` (all generic rules plus the Effect group, at `error`). The copy is ours; `UPSTREAM.md` there says where it came from and how to take upstream fixes
- Oxlint `1.83.0` with Ultracite `7.12.0`, Oxfmt `0.68.0`, and Turborepo `2.11.2`
- varlock `1.20.0`: declare every env var in `.env.schema`, never read `.env.local` directly, run `pnpm env:check` after schema edits

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@rat-stack/capability` | `packages/capability` | `defineContract`, `implement`, and the `toCommand`, `toHttpApi`, `toToolkit`, `toRpc`, and `toCodeMode` projections |
| `@rat-stack/core` | `packages/core` | Shared `inspectFile`, `search`, and `read` contracts; `inspectFile` handler, lifecycle machine, and `FileInspector` |
| `@rat-stack/database` | `packages/database` | Database cartridge: the `RunLog` service and the `DatabaseVendor` choice (D1 or Hyperdrive Postgres), with each vendor's schema, migrations, and resources |
| `@rat-stack/auth` | `packages/auth` | Better Auth cartridge over the chosen `DatabaseVendor`: `Auth`, `CurrentPerson`, and the RPC middleware that provides it; only `Unauthenticated` crosses the wire. `@rat-stack/auth/devtools` adds `runAsPerson`, the dev-only `rat_test_person` capability, and `testPersonLayer` |
| `@rat-stack/events` | `packages/events` | Events cartridge: capture-first request analytics. `withEventCapture` records one `request` event per HTTP request behind the `EventSink` port; `@rat-stack/events/basin` declares the Cloudflare Basin resources (R2 Data Catalog, unstructured Pipelines stream with public ingest off, Iceberg sink, `SELECT *` pipeline, visitor salt) and provides the sink; `@rat-stack/events/memory` is the in-memory sink for tests. Tests are property and model based (`it.prop`, `it.effect.prop`). Mischief provides it in `apps/mischief/src/worker.ts`; `EVENTS_ENABLED` (default false) turns capture and the catalog, sink, and pipeline on, and reads `EVENTS_SINK_TOKEN` at deploy time only; off still declares the bucket, stream, and salt so their state survives. `EVENTS_IDENTITY_MODE` picks `daily` or `persistent` visitor ids |
| `@rat-stack/subscriber-delivery` | `packages/subscriber-delivery` | External subscriber intake and confirmation adapter; implements core's job-shaped `SubscriberIntake` and `SubscriberConfirm` ports, provided by the Worker, never imported by core |
| `@rat-stack/learn` | `packages/learn` | Source-derived public concept deck and the learning lifecycle. Stateless capabilities return compact progress; the CLI MCP provides the local append-only JSONL adapter for core's `LearnerProgress` port. |
| `@rat-stack/lore` | `packages/lore` | Public content graph and traversal service |
| `@rat-stack/devtools` | `packages/devtools` | 🐀 devtools cartridge: `CallLog`, `record`, and the `rat_*` capabilities that list, read, dispatch, replay, and diff capability calls |
| `@rat-stack/web` | `apps/web` | Default UI bin: TanStack Start on Vite, deployed as `Website` (`apps/web/src/website.ts`). Browser `client/` builds AtomRpc from contracts; `/rpc` uses the `#backend` import: production forwards to the private `RpcBackend` in `apps/mischief/src/rpc-worker.ts`, and `pnpm --filter @rat-stack/web dev` serves the content capabilities in process from `src/dev/backend.ts` (the `development` condition in `apps/web/package.json`). In dev, `src/dev/backend.ts` runs the content capabilities under devtools: `/rpc` calls are recorded, `/__rat/rpc` serves the 🐀 overlay (`#devtools-overlay`, `src/dev/features/overlay`, ⌘K), and `/__rat/mcp` serves every `rat_*` tool to agents, with memory-Auth test people. `src/dev/client` and `src/dev/features` follow the browser rules. `test/production-bundle.test.ts` proves no `src/dev` module, no devtools code, and no test people reach a production build. Include it in the Stack with `const website = yield* Website;` |
| `@rat-stack/cli` | `apps/cli` | Composition root: `stats`, `catalog`, `openapi`, `serve [--devtools]`, `mcp [--code-mode] [--devtools]` commands |
| `@rat-stack/infra` | `apps/infra` | Alchemy Stack: the project's cloud footprint as one Effect program |
| `@rat-stack/mischief` | `apps/mischief` | Cloudflare Worker: the public site, agent discovery, and sandboxed execute surface |

## Nouns

| Noun | Home | Runtime job |
| --- | --- | --- |
| Contract | `packages/core/src/contracts.ts` | Shared name, schemas, failure, annotations, and approval setting. |
| Capability | `packages/core/src/inspect-file.ts` or `apps/mischief/src/capabilities/<name>.ts` | Binds one contract to its server-side handler with `implement`. |
| Projection | `packages/capability/src/to-<surface>.ts` | Expose implemented capabilities on one runtime surface. |
| Cartridge | `packages/<name>/src/` | One Layer with its own infrastructure; it must pass the cartridge test in `VISION.md`. |
| Machine | `packages/core/src/<name>-machine.ts` | Own one finite domain lifecycle. |
| Feature | `apps/web/src/features/<name>/` | Thin route and view that read client atoms. |
| System page | `.brain/areas/<name>.svx` | Public page at `/systems/<name>` for one system rat-stack ships: what it does, the standard it keeps, and how to check it. The content build rejects a system page without those three sections or outside `.brain/areas/`. |
| Client | `apps/web/src/client/<name>.ts` | Own AtomRpc queries, named commands, and the local replica. |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install workspace dependencies |
| `pnpm sources:fetch` | Import missing pinned code objects once before the first gate; generation stays local-only |
| `pnpm dev` | Run `apps/web` under `vite dev` through portless at `http://rat-stack.localhost:1355` (worktrees get their own prefix); `portless list` shows the route |
| `pnpm check` | Typecheck, verify formatting, and run type-aware linting |
| `pnpm lint` | Type-aware lint plus format check only; `turbo run check` runs this once at the root as `//#lint` |
| `pnpm fix` | Apply Oxfmt and safe Oxlint fixes |
| `pnpm test` | Build and run the Vitest suite once |
| `pnpm build` | Compile package outputs |
| `pnpm typecheck` | `turbo run typecheck` |
| `pnpm vendor:agent-sources` | Shallow-clone Effect, effect-solutions, xstate, alchemy, better-auth, and TanStack Router/Start mirrors |
| `pnpm infra:plan` | Preview the Alchemy Stack diff without applying |
| `pnpm infra:deploy` / `pnpm infra:destroy` | Apply or tear down the Stack (asks for approval) |
| `pnpm exec lefthook install` | Install git hooks (also via `prepare`) |
| `pnpm turbo run check test build` | Required validation before claiming a change is ready |

Run `pnpm fix` only when you intend to rewrite files. Finish with `pnpm turbo run check test build`.

## Deploy

- Run `pnpm turbo run check test build --concurrency=1` before deployment.
- `pnpm deploy:plan --profile <profile>` reads and classifies the production plan without applying it.
- `pnpm deploy:prod --profile <profile> --yes` applies that exact plan, then runs typed checks and a bounded watch.
- `pnpm deploy:rollback --profile <profile> --yes` restores prior Worker versions from a local apply receipt. It requires explicit approval; no automatic rollback runs.
- Recovery evidence lives in gitignored `.rat/deploy/`. Rollback writes separate progress receipts and preserves its source.
- Content-version mismatches retry for 120 seconds by default. `DEPLOY_CONTENT_VERSION_DEADLINE_MS` sets a bounded override; verdicts retain failed attempts.
- Application-secret resolvers belong in gitignored `.env.production.local`, under `.env.schema` keys. The root commands run varlock in production mode; provider credentials remain profile-only.
- Set `ALCHEMY_PROFILE` explicitly. It must match `--profile`. The driver refuses environment provider credentials.
- `.env.schema` owns required production inputs. Missing inputs stop before planning. Verdicts record key names only.
- Only updates and no-ops pass by default. Use `--allow` with a JSON array of exact `{resource, action}` pairs for other actions.
- An allow-list does not grant approval. Replacements and deletions still need owner sign-off, recorded with `--owner-approved` as well as exact allow entries.
- Classification reads Alchemy Plan values, including binding and task changes. Retention is a physical-resource backstop, not a delete guard: it removes state rows and leaves cloud objects. Apply receipts list confirmed retained orphans. Alchemy confirmations use the capability approval service; unattended input prompts fail typed.
- Partial apply exits 4 and names completed and incomplete resources. A crash exits 5. Unknown evidence never establishes health.
- The driver refuses Alchemy state-store bootstrap during planning. Bootstrap needs separate authorization.
- Keep `pnpm mischief:smoke` until typed checks pass in production. Phase 1 adds no production qualification or automatic rollback.
- Procedure: [ship](/skills/ship), with project commands in `skills/ship/references/project.md`.

## Fence (cheating is uncomfortable)

Why lives in `AGENTS.md` / `VISION.md`. The stack and hooks are the enforceable fence. Fence wins over prose.

- Lefthook pre-commit runs `pnpm check` and `pnpm test`
- Agents must not use `git … --no-verify` (or equivalent hook bypass)
- Blocked by: Pi `.pi/extensions/git-interceptor`, Cursor `.cursor/hooks.json`, Claude Code `.claude/settings.json`
- Policy source: `scripts/vcs-command-policy.js`

If a hook fails, fix the failure. Do not disable the fence.

## Source-first Effect / XState work

Before writing, reviewing, or refactoring Effect or XState code, read the installed Effect package's `AGENTS.md` first, for example `packages/core/node_modules/effect/AGENTS.md`. It ships with the installed version, so it is never stale. Then inspect vendored source for the pinned versions. Populate mirrors:

```sh
pnpm vendor:agent-sources
# or
./scripts/vendor-agent-sources.sh --refresh
```

Inventory: `.agent_sources/README.md` is generated in the local source mirror and is not part of this repository.

| Need | Path |
| --- | --- |
| Effect Schema, Context.Service, CLI | `.agent_sources/github.com/Effect-TS/effect/` |
| Idiomatic Effect | `.agent_sources/github.com/kitlangton/effect-solutions/` |
| XState | `.agent_sources/github.com/statelyai/xstate/` |
| `@xstate/effect` (v6 Effect bridge) | `.agent_sources/github.com/statelyai/xstate/packages/xstate-effect/` (`README.md`, `docs/`, `src/*.test.ts`) |
| Alchemy resources, Cloudflare, AWS | `.agent_sources/github.com/alchemy-run/alchemy/` and https://alchemy.run/llms.txt |

Refs are derived from the workspace pins, so bumping a package and re-running the script keeps them matched. The `pi-effect` tool reads the Effect mirror in place; it needs no link.

Mirrors are reference material, not runtime dependencies. Exclude them from typecheck, test, lint, and format. Do not vendor product-specific corpora in this template.

## Source control

Preserve existing work. Inspect status before editing, stage only files changed for the current task, and do not commit generated output, secrets, or populated `.agent_sources/github.com/` trees. Use the repository's existing source-control tool; do not initialize or migrate one without approval. Never pass `--no-verify` to git.

## Project law

A child project replaces this section on day one with its own product rules. These rules describe the rat-stack template, not the product in a clone. Keep durable product intent in `VISION.md`.

- One contract, every surface. Define schemas and metadata with `defineContract`; bind a server-side handler with `implement` and add the capability to `capabilities`. CLI, HTTP, MCP, RPC, and code mode are projections in `packages/capability`. Do not add a command, route, or tool handler that bypasses a capability.
- Schemas are the contract. Input, output, and failure are Effect `Schema`; JSON Schema, OpenAPI, and the code-mode declarations are derived from them, never hand-written.
- Lifecycles are machines. Finite modes, retries, and cancellation live in XState machines started with `createEffectActor`; side effects live in declared `fromEffect` actors, never inline.
- The sandbox is a surface, not a bypass. Anything reachable from a code-mode program must be a capability and goes through that capability's schemas and handler.
- Gardener rule: add a lint rule before cleaning up a bad pattern; lint baselines only shrink. The routine is `skills/gardener`; before simplifying or replacing a design, run `skills/uncomplect`.
- Refresh peers, versions, and tiers every week or two and after every bump of Effect, Alchemy, XState, or `@xstate/effect`. The repo-native `skills/gardener` pass owns the peers refresh through `skills/find-peers`: check default-branch manifests or lockfiles, record exact versions and checked dates in `.brain/data/peers.json`, and explain tiers with evidence. The content build reads our pins from manifests and filters/sorts that dataset into `.brain/resources/peers.svx`; never hand-edit table rows. Drift is expected. Preserve every peer; show S through B in the main table and C through F in a collapsed Also seen list. Put the rubric and full ranking at the top of the report for feedback after shipping; no separate approval round is required.
- Tautological tests considered harmful.
- Change-detector tests considered harmful.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing.
- Prefer property and model tests over example tests. A domain rule is an `it.prop` over Effect `Arbitrary` inputs; anything with history (sessions, retries, lifecycles) is a model checked over generated command sequences. Keep example tests for seams. Plant a bug before trusting a new property: it must fail. Reference: `packages/events/test/`.
- Errors are part of the interface. Name the failure, keep its source context, say how to fix it, and fail at the boundary. Build-time code references accumulate every independent failure before emitting assets; drift is a warning, never a fallback.
- Code excerpts use fenced Markdown, not `<Code>`. Metadata is whitespace-separated `key=value` or `key="quoted value"` (JSON string escaping), plus at most one `{3,5-7}` highlight set. Allowed keys: `repo`, `path`, `at`, `lines`, `title`. Inline example: `ts {3,5-7} title="example.ts"`. Reference example: `ts repo=rat-stack path=apps/cli/src/surfaces.ts at=<full-sha> lines=21-25`, with an empty body. Ranges and highlights use positive, ordered, non-overlapping line numbers. Explicit language wins, otherwise a referenced file extension, otherwise Markdown; `svx` maps to Markdown and `txt` to text. Unknown explicit languages, unknown or duplicate keys, malformed metadata, nonempty reference bodies, unavailable Git objects and invalid ranges fail with typed repair messages. Configured excerpts show at most 25 source lines; gap labels do not count. `packages/code-snippets` owns the build-only pipeline and ports; `/git` and `/shiki` are adapters. Registry renderers in Mischief derive both views from one CodeSnippet. Worker graphs must contain neither code-snippets nor Shiki. A shallow clone must contain each pinned object or fetch its history before building.
- No comments in code. `no-comments/no-comments` (`scripts/oxlint-plugin-no-comments.ts`) bans them, after Lauren Tan's Dune rule: agents copy comments, and a comment that explains a workaround spreads the workaround. Say it in a name, a type, a test, a commit message, or the Brain. Two kinds survive: tool directives, with the reason inline after `--`, and a one-line `SAFETY:` invariant above a type assertion. TypeScript's `@ts-expect-error`, `@ts-ignore`, and `@ts-nocheck` count as directives here; `typescript/ban-ts-comment` decides which may stay, so write `// @ts-expect-error -- <reason>`. `--fix` deletes prose, so move anything a comment knows into a name, a test, the commit, or the Brain before running it. Plain JS files keep JSDoc blocks made only of type tags (`@param {string} command`), because that is their type syntax; Ultracite's JSDoc description rules are off for the same reason. Credit for borrowed code lives in `PROVENANCE.md`.
- Diagnostic overrides are targeted and explained: `// @effect-diagnostics-next-line <rule>:off -- <reason>`. File-level overrides exist only at projection boundaries (`packages/capability/src/to-toolkit.ts`, `packages/capability/src/to-code-mode.ts`, `packages/capability/src/to-rpc.ts`) and in process-spawning test files.
- Lint overrides follow the same rule: `// oxlint-disable-next-line <rule> -- <reason>`. Every type assertion carries a one-line `SAFETY:` comment naming the invariant it relies on. `unicorn/throw-new-error` is off because `Schema.TaggedError(...)` looks like a throw to it. Anti-slop overrides exist only where a type is erased on purpose (the projections in `packages/capability`, the sandbox RPC boundary, the lint plugin's AST walker); anywhere else, parse the value at its boundary with Effect `Schema`.
- Hot pink is the only accent. `--accent` (#ff1493) marks borders, rules and focus rings; `--accent-text` (#c8006e, 5.7:1 on white) is the only pink text. Use it for at most one thing per screen, plus focus. Today that is the workshop callout rule and label, `:focus-visible`, and the copy button's copied state; links, headings, tables and tier cells never use it. `apps/mischief/test/accent.test.ts` holds the allowed selectors.
- Pins stay exact. A vendored dependency carries a matching `minimumReleaseAgeExclude` entry and a removal rule in `vendor/README.md`.

## Architecture

A child project replaces this section on day one with its own architecture. Record module boundaries, dependency direction, data ownership, and state-machine seams here. Link deeper docs instead of duplicating them.

- `rat-stack-boundaries/no-core-adapters` keeps provider adapters out of core. Core owns job-shaped ports; adapter packages implement them, and apps provide them at composition. `packages/subscriber-delivery` implements subscriber intake and confirmation; `packages/core/test/boundaries-rule.test.ts` checks the boundary.
- `rat-stack-boundaries/no-cross-layer-imports` enforces dependency direction: `apps/cli` → `packages/core` → `packages/capability` → Effect/XState. Packages do not import apps; `packages/capability` does not import domain code; `apps/infra` owns its Stack wiring. `core` owns shared contracts and the `inspectFile` handler; each capability's owner keeps its handler beside its data or infrastructure. Core depends on `capability` for `defineContract` and `implement`.
- `rat-stack-boundaries/no-browser-server-imports` applies to `apps/*/src/features/**` and `apps/*/src/client/**`. Browser modules may import only `@rat-stack/core/contracts` and `@rat-stack/capability/rpc-group` from these packages; they cannot import handler modules. `rat-stack-boundaries/no-feature-transport` applies to `apps/*/src/features/**`.
- `rat-stack-boundaries/no-hand-rolled-surface` keeps `Rpc.make`, `RpcGroup.make`, `HttpApi*`, `Tool.make`, and `Toolkit.make` inside `packages/capability`; everything else projects contracts. `rat-stack-boundaries/no-browser-globals-on-server` keeps `window`, `document`, `navigator`, and web storage in `apps/*/src/client/**` and `apps/*/src/features/**`.
- `rat-stack-patterns` (`scripts/oxlint-plugin-patterns.ts`): `contract-binding-matches-name` (`const searchContract = defineContract("search", …)`), `no-module-level-mutable-state` (module `let`/`var` in `apps/*/src` and `packages/*/src` leaks across Worker requests), and `acquire-release-constructs-in-acquire-body` (build pools inside acquire, not before).
- `packages/core/src/file-inspector.ts` is the reference service shape: a `Context.Service` class whose `make` captures its dependencies so its methods carry no requirements, with `static layer` beside it. `packages/core/src/config-service.ts` derives a service from Effect `Config` (production `layer` reads the ConfigProvider, `configLayer` takes parsed values for tests); `AppConfig` is the instance and mirrors `.env.schema`.
- `packages/core/src/inspect-machine.ts` is the reference shape for a lifecycle: the machine owns states, declared `fromEffect` actors own side effects and typed failures, `join` plus `Effect.orDie` hands the outcome back to Effect. `packages/core/src/contracts.ts` owns `inspectFileContract`; `packages/core/src/inspect-file.ts` implements it and registers the capability.
- Effect-backed machines start only under `createEffectActor`, never `createActor`. Only actions and actors declared in `setupEffect` contribute to the actor's requirements; the `xstate-effect/no-inline-effect` lint rule enforces the inline cases.
- `packages/capability/src`: `contract.ts` defines shared contracts; `implement.ts` binds typed handlers and adds approval requirements; `to-command.ts`, `to-http-api.ts`, `to-toolkit.ts`, `to-rpc.ts`, and `to-code-mode.ts` project implemented capabilities. `to-rpc-group.ts` builds the contract-only client group; `to-rpc.ts` derives the server group from those same contracts. `catalog.ts`, `sandbox-service.ts`, and `sandbox-subprocess.ts` support code mode. `to-code-mode.ts` imports from `to-toolkit.ts`, so MCP is a prerequisite for code mode.
- Devtools are capabilities: `devtools(capabilities)` adds the `rat_*` capabilities, and a dev composition provides the recording layer from `devtoolsLayer()` through `CallWatch` (`@rat-stack/capability/call-watch`). `implement` reads that ambient reference once per call and surrounds the approval-gated handler, so denied calls are recorded too; the default is a no-op. `CallWatch` observes calls across projections without changing their capability lists. `aroundHandlers` stays as the explicit wrapper over one capability list: drovr uses it for `writeGate` to serialize and audit approval-gated writes. Both compose because `implement` reads `CallWatch` inside the handler that `aroundHandlers` wraps; the gate runs outside the recorder. `rat_call` dispatches through `invokerFor`, the same path code mode uses. Machines report through `watchActor` (`@rat-stack/capability/actor-watch`), a no-op `ActorWatch` reference that the recorder overrides; `rat-stack-patterns/watch-effect-actors` requires the call. `devtools(capabilities, { runAs })` records each call's identity and lets `rat_call` take `as`; the composition root passes `runAsPerson` from `@rat-stack/auth/devtools`, so devtools never imports auth. `rat-stack-boundaries/no-devtools-in-production` keeps `@rat-stack/devtools` and `@rat-stack/auth/devtools` in `apps/*/src/dev/**`, `apps/cli`, and tests, and keeps everything outside an app's `dev/` folder from importing it, so a deployed entry cannot reach `rat_call` or test people. `--devtools` binds `127.0.0.1` only. Plan and tool list: `.brain/projects/rat-devtools.svx`.
- `apps/cli/src/surfaces.ts` is the only place projections are instantiated; `apps/cli/src/command.ts` maps them to subcommands; `apps/cli/src/cli.ts` is the single composition root that provides `FileInspector` and `NodeServices`.
- The [README's Keep or cut section](./README.md#keep-or-cut) lists what to delete per surface.

## Wiki writing

Lore and system pages use low prose, about 80% ASD-STE100 Simplified Technical English. This is a house style, not certification.

- Aim for sentences of 20 words or fewer. Descriptive sentences may use up to 25 words.
- Put one idea in each sentence. Use active voice and present tense.
- Use the same glossary term for the same thing. Remove idioms and filler.
- Prefer lists to paragraphs. Put one instruction in each step.
- Keep lore titles as claims. Keep Joel's voice unchanged inside quotes.
- Be plain and strict, not robotic.

Use a visual only when it explains the point. Choose a fenced box-drawing diagram for flow or topology, a table for trade-offs or state, pseudocode for logic, or a shallow file tree. Keep diagrams below 80 columns. Give each visual one or two nearby sentences. Add a **What to notice** line only when the point is not obvious from those sentences. Do not add decorative visuals.

Write for a person first. Avoid hedged 'X, not Y' asides and narration about sources.

The content generator warns on sentences above 25 words and paragraphs above four sentences in lore and systems pages. It also warns on history wording, contrast hedges, and em dashes. It reads parsed Markdown prose. The style rules skip quoted spans, blockquotes, code, links, tables, and frontmatter. Length rules still count link labels. Warnings show `file:line` and a total count. They never fail the build. Fix new warnings or explain why they remain.

## Web feature blueprint

`apps/web/src/features/<name>/` holds a thin route and view. It reads atoms and calls named commands from `apps/web/src/client/<name>.ts`; components never handle transport, retries, or process startup. The client owns AtomRpc queries and the local replica. The capability in `packages/core` is the shared typed edge, imported by both sides. A cartridge owns durable behavior.

One send follows one path: feature → named client command → AtomRpc → shared capability → server-side Durable Object or database cartridge. The server stays authoritative. Mutations carry `reactivityKeys` so the client reconciles its replica.

## Boundaries and sign-off

A child project replaces this section on day one with its own boundaries. This section names changes agents may make directly and changes that need owner approval.

- Safe by default: adding a capability in `packages/core` and wiring it into `capabilities`; new or tightened tests; a targeted diagnostic override with a written reason; README, AGENTS.md, and `.brain/` edits; tightening a lint rule; removing a surface by following Keep or cut; any change under `apps/infra`, and `pnpm infra:deploy` once `pnpm infra:plan` shows only the intended diff and the gate passes, followed by `pnpm mischief:smoke`.
- When a call is unclear, get a second opinion from a Pi session on `openai-codex/gpt-6-astra:xhigh` before asking the owner.
- Needs owner sign-off: adding or changing a dependency version (pins are exact and CI installs cold); any edit to `oxlint.config.ts`, the diagnostics map in `tsconfig.base.json`, `lefthook.yml`, or `scripts/vcs-command-policy.js` that loosens the fence; `pnpm infra:destroy`, and a deploy whose plan replaces or deletes a resource; widening sandbox permissions or adding a runtime that reaches the network; exposing `serve` or `mcp` beyond localhost; vendoring a package as a `file:` tarball; deleting `.agent_sources/` or `vendor/`.
