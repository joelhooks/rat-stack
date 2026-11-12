# rat-stack 🐀

_An Effect stack so pure (aspirational) Kit Langton will blush._

[![CI](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml)

Build an Effect app and its cloud as one typed program. Joel's goal is the best Effect + Alchemy application we can build; `VISION.md` explains why. `AGENTS.md` sets exact pins, checks, and hooks. The public tree lets you steal ideas. It carries no product support promise.

The **pnpm + Turborepo workspace** includes a working Effect v4 CLI, tests, formatting, and type-aware linting. Vendored source mirrors cover Effect, effect-solutions, XState, and Alchemy.

Define a **Contract** with Effect input, output, and failure schemas plus annotations. Bind a server-side handler, then project the capability onto every agent surface. The same `inspectFile` capability is the `stats` command, `POST /inspectFile` with an OpenAPI document, and an MCP tool over stdio.

## Use it as a reference

rat-stack works best as a reference: read it, run it, and take the patterns you need into your own project. Copying the whole thing is the exception. A copy inherits every pin, fence, and cartridge, and you own each upgrade after that.

Clone it, then install and verify it:

```sh
gh repo clone joelhooks/rat-stack
cd rat-stack
nvm use
pnpm install
pnpm vendor:agent-sources
pnpm sources:fetch
pnpm turbo run check test build
```

Node `24.18.0` and pnpm `11.3.0` are the supported versions. `packageManager` pins pnpm `11.3.0` exactly, so Corepack installs that version. `.nvmrc` names Node `24.18.0` for nvm and fnm, and `engines` sets minimums. `devEngines` names the same versions but only warns, so a different tool still installs. Keep exact package-manager pins with `onFail: "error"` out of anything another tool installs as a package: it fails every consumer whose npm or pnpm differs.

## Workspace layout

- **`apps/cli`**:
  - Package: `@rat-stack/cli`
  - Role: Composition root: `stats`, `openapi`, `serve`, `mcp`
- **`packages/capability`**:
  - Package: `@rat-stack/capability`
  - Role: `defineContract`, `implement`, and the `toCommand`, `toHttpApi`, `toToolkit`, `toRpc`, and `toCodeMode` projections
- **`packages/core`**:
  - Package: `@rat-stack/core`
  - Role: Domain example: the `inspectFile` contract, handler, and lifecycle machine
- **`packages/flags`**:
  - Package: `@rat-stack/flags`
  - Role: Typed flags, Config, memory and KV adapters, stable rollouts, audited writes, and removal dates
- **`packages/events`**:
  - Package: `@rat-stack/events`
  - Role: Request analytics: capture, visitor privacy rules, and Basin resources behind core's `EventSink` port
- **`packages/crash`**:
  - Package: `@rat-stack/crash`
  - Role: Private crash-trace archive for the Mischief Worker
- **`packages/motion`**:
  - Package: `@rat-stack/motion`
  - Role: Easing, tweens, springs and interpolation as dependency-free TypeScript, with an optional Foldkit adapter
- **`packages/lore`**:
  - Package: `@rat-stack/lore`
  - Role: Public content graph and traversal service
- **`packages/subscriber-delivery`**:
  - Package: `@rat-stack/subscriber-delivery`
  - Role: External subscriber intake and confirmation adapter behind core's job-shaped ports
- **`apps/infra`**:
  - Package: `@rat-stack/infra`
  - Role: Alchemy Stack (Cloudflare by default)
- **`apps/site`**:
  - Package: `@rat-stack/site`
  - Role: Cloudflare Worker for the public site, agent discovery, and sandboxed execute
- **`.agent_sources/`**:
  - Package: —
  - Role: Shallow upstream mirrors (gitignored clones; see README there)

## Try the example CLI

The included `stats` command counts bytes, Unicode characters, words, and lines in a file:

```sh
pnpm cli stats README.md
pnpm cli stats README.md --json
```

After `pnpm build`, you can run the built entrypoint directly:

```sh
node apps/cli/dist/cli.js stats README.md
```

The same capability on the other surfaces:

```sh
pnpm cli openapi                 # OpenAPI 3.1 document for the REST projection
pnpm cli serve --port 3000       # POST /inspectFile, GET /openapi.json, GET /docs
pnpm cli mcp                     # MCP server over stdio, one tool per capability
pnpm cli mcp --code-mode         # MCP server with two tools: search and execute
pnpm cli catalog --types         # the `tools` declarations a code-mode program sees
```

Code mode is another projection. The model gets `search` for ranked matches with TypeScript signatures and `execute` for JavaScript with `tools` in scope. The program runs in a fresh Node subprocess under `--permission`. It cannot touch the file system or spawn processes. To call the host, it uses `tools.<name>(input)`. The host validates the input schema and runs the same handler used by every other surface. Node's permission model allows network egress. Put a Worker or Deno runtime behind the same `Sandbox` service to isolate the network too.

`packages/capability/src` is where a capability becomes a `Command`, an `HttpApiEndpoint`, a `Tool`, and a catalog entry. `packages/core/src/inspect-file.ts` supplies the CLI's example capability. Hosted content has its own registry in `apps/site/src/capabilities/index.ts`. Provider adapters stay outside core (`rat-stack-boundaries/no-core-adapters`); apps provide them to core's job-shaped ports at composition. Add another to `capabilities`, then verify every projection you keep; CLI command registration lives in `apps/cli/src/command.ts`.

## What is in the stack?

- **pnpm workspaces + Turborepo `2.11.10`**: cached `typecheck` / `test` / `build` across packages from day one.
- **Effect `4.1.2`**: typed runtime, errors, filesystem service, and the three surfaces the capabilities project onto: `effect/cli`, `effect/http-api` (with `OpenApi.fromApi`), and `effect/ai` (`Toolkit` + `McpServer`).
- **`@effect/platform-node` `4.1.2`**: Node-backed services; keep adapter and core pins matched.
- **TypeScript `7.0.2`**: strict module and index-access checks.
- **`@yielded/effect-tsrs` `0.2.3`**: runs TypeScript and Effect diagnostics in `typecheck` and `check`. `--type-check` includes ordinary TypeScript diagnostics; `--strict` makes Effect warnings fail. It bundles tsrs `8f135f106a63`, contained in plain tsrs `0.20.0`.
- **tsrs `0.23.0-ts7.1.0-beta`**: experimental compiler targeting TypeScript `7.1.0-beta` for `typecheck:fast`. It still has no Effect diagnostics; use `typecheck` or `check` for those.
- **XState `6.0.0-beta.1`**: real lifecycle states; do not replace those with boolean soup.
- **`@xstate/effect` `1.0.0-beta.0`**: the official XState v6 to Effect 4 bridge: `createEffectActor` runs a machine as a scoped Effect, `createEffectLogic` makes Effects into actors with typed failures and requirements. `packages/core/src/inspect-machine.ts` is the example.
- **Alchemy `2.0.0-beta.85`**: [Infrastructure as Effects](https://alchemy.run): `apps/infra/alchemy.run.ts` is the Stack; cloud providers come from `@alchemy.run/cloudflare`, `@alchemy.run/drizzle`, and `@alchemy.run/sql`; `pnpm infra:plan` / `infra:deploy` / `infra:destroy`; auth via `pnpm alchemy profile edit`.
- **Foldkit `0.170.0` + `@foldkit/vite-plugin` `0.29.0`**: the web UI. Server rendering and prerendering are on by default. One `vite build` writes the browser bundle, a server `fetch` function, and an HTML file for every public page. `Cloudflare.Website.Foldkit` serves the files and sends every other request to that function. The browser hydrates the same view. `.brain/areas/web.svx` is the system page.
- **Oxlint + Ultracite + Oxfmt**: native lint and format.
- **Vitest `5.1.0` + `@effect/vitest` `4.1.2`**: `it.effect` and `it.layer` for every Effect test; running Effects by hand in a test file is a lint error.
- **`@effect/tsgo` `0.67.5`**: patches TypeScript 7 in `prepare` for `typecheck:tsc`. Effect warnings fail because `ignoreEffectWarningsInTscExitCode` stays false. Patched `tsc` runs at the switch and on checker bumps through parity, not on every CI run. Report any checker disagreement.
- **varlock `1.24.0`**: `.env.schema` declares every variable with `@env-spec` decorators; `pnpm check` runs `varlock load`, secrets stay in gitignored `.env.local`.
- **Vendored agent sources**: Effect, [effect-solutions](https://github.com/kitlangton/effect-solutions), XState, [Alchemy](https://github.com/alchemy-run/alchemy), [Better Auth](https://github.com/better-auth/better-auth), and [Foldkit](https://github.com/foldkit/foldkit) via `./scripts/vendor-agent-sources.sh`, each at the ref its workspace pin names (not x-algorithm; that stays app-specific).
- **Agent fence**: lefthook pre-commit + Pi/Cursor/Claude hooks that block `git … --no-verify`. Cheating should be uncomfortable and obvious.

Every dependency is pinned exactly. Review pin upgrades as stack changes.

## Commands

- **`pnpm typecheck`**: Check TypeScript and Effect diagnostics with strict effect-tsrs
- **`pnpm typecheck:tsc`**: Run patched TypeScript `7.0.2` / `@effect/tsgo` `0.67.5`; runs at checker bumps, not in CI
- **`pnpm typecheck:fast`**: Fast feedback with tsrs; no Effect diagnostics; `pnpm check` stays the gate
- **`pnpm typecheck:parity`**: Compare effect-tsrs and patched `tsc` errors and exit verdicts, including `TS377xxx`; also compare plain tsrs with Effect-only codes excluded
- **`pnpm bump:checkers`**: Bump both exact checker pins to npm latest, report bundled revision alignment, and run both parity pairs
- **`pnpm check`**: Typecheck, check formatting, and run type-aware linting
- **`pnpm fix`**: Apply Oxfmt and safe Oxlint fixes
- **`pnpm test`**: Run the Vitest suite once
- **`pnpm build`**: Compile package outputs
- **`pnpm cli -- ...`**: Build and run the CLI
- **`pnpm vendor:agent-sources`**: Clone core lib mirrors
- **`pnpm turbo run check test build`**: Cached verification pipeline

## Agentic surface

Every clone includes `AGENTS.md` for repo law and commands, `CLAUDE.md` as Claude Code's pointer to that law, and `VISION.md` for project intent. Source mirrors live under `.agent_sources/` after you run the vendor script. Repo-local Pi extensions belong in `.pi/extensions/`.

## Copy the whole template

When you do want a full copy instead of borrowed parts, start from the template:

```sh
gh repo create <name> --template joelhooks/rat-stack
```

Clone the new repository in full, then install it and record its history:

```sh
pnpm install
pnpm sources:fetch
pnpm git-snapshot
git add .brain/data/git-snapshot.json
git commit -m "chore: snapshot this repository's history"
```

`pnpm sources:fetch` imports missing pinned source commits from the configured repository remotes once, including in template children. Generation reads only local Git objects and never fetches. Re-run the command when adding a new pin that is not present locally.

A repository created from the template starts with one squashed commit, so the template's Git snapshot no longer matches its history. `pnpm git-snapshot` rebuilds it, and the content build passes once that commit lands. A `--depth 1` clone stops the content build, because the page history needs the whole branch.

Rename the workspace package names before you build on the example. These are examples, not the full package inventory:

- `package.json`: `rat-stack`
- `apps/cli/package.json`: `@rat-stack/cli`
- `apps/infra/package.json`: `@rat-stack/infra`
- `apps/site/package.json`: `@rat-stack/site`
- `packages/capability/package.json`: `@rat-stack/capability`
- `packages/core/package.json`: `@rat-stack/core`

Rename the `bin` entry in `apps/cli/package.json`, the root command in `apps/cli/src/command.ts`, and the version in `apps/cli/src/version.ts`. Then change every matching import and workspace manifest reference. Find the current `@rat-stack/` names with:

```sh
rg -n '@rat-stack/' --glob '*.json' --glob '*.ts' -l
```

A new scope changes line lengths, so run the formatter once after the rename:

```sh
pnpm fix
```

Replace `inspectFile` in `packages/core` with one useful capability. Add it to `capabilities`, then verify each surface you keep. Rewrite the Project law, Architecture, and Boundaries sections of `AGENTS.md` and the top of `.pi/APPEND_SYSTEM.md`; they describe rat-stack until you do. Keep expected failures typed and map them to deliberate exit codes.

`apps/site` is the public site and Worker. `apps/infra` is its Alchemy Stack. The browser reader and content build also depend on `apps/site`; deleting those directories alone is not a supported cut. Trace the dependencies in Keep or cut first. If you keep the site, change the Cloudflare Zone name and the DNS names and targets derived from it in `apps/infra/alchemy.run.ts`. Change the Worker domain and redirects in `apps/site/src/worker.ts`. Choose an Alchemy stage for each plan or deploy. The stage is a command-line choice, for example `--stage <stage>`. Configure credentials with:

```sh
pnpm alchemy profile edit --add Cloudflare
```

Run the acceptance gate before the first push:

```sh
pnpm turbo run check test build
```

## What it promises and how to check

- One capability reaches every kept surface. Proof: `packages/capability/test/to-command.test.ts`, `packages/capability/test/to-http-api.test.ts`, `packages/capability/test/to-toolkit.test.ts`, `packages/capability/test/to-code-mode.test.ts`, and `apps/cli/test/cli.e2e.test.ts`.
- Schemas are the contract. Proof: `packages/capability/test/catalog.test.ts`, `packages/capability/test/to-http-api.test.ts`, and `packages/capability/test/to-toolkit.test.ts` check derived JSON Schema and typed failures.
- A fresh sandbox isolates model code. The Node sandbox has a 10-second wall-clock limit and a 1-second limit per synchronous evaluation. Both run inside the child. Scope close and interruption send SIGTERM, then SIGKILL after 250 milliseconds. Stdin EOF, a lost parent, or a failed protocol write ends the child. Child-process imports remain blocked. Proof: `packages/capability/test/sandbox.test.ts` checks isolation and VM budgets; `sandbox-lifetime.test.ts` and `sandbox-orphan.test.ts` check deadlines, parent death, and process-group cleanup.
- Rate limits fail closed. Proof: `apps/site/test/worker.test.ts` checks 429 responses before another execute worker starts and when the global limit denies.
- Markdown is the default machine representation. Proof: `apps/site/test/worker.test.ts` checks Markdown without `Accept: text/html` and HTML only when requested.

## Keep or cut

Choose a feature cut below. Combined package names mean the dependent features go together; the Keep entries name shared build dependencies, not independent removal recipes. After each cut, update the package list in `AGENTS.md` and run `pnpm install`, `pnpm fix`, `pnpm git-snapshot`, and `pnpm turbo run check test build`. For projection cuts, trim `packages/capability/src/index.ts` too. These are local-source cuts, not instructions to destroy deployed resources or data.

- **Only the CLI**:
  - Keep: `packages/capability/src/contract.ts`, `packages/capability/src/implement.ts`, `packages/capability/src/to-command.ts`, `call-watch.ts`, `actor-watch.ts`, every dependency imported by retained code, and their tests; all of `packages/core`; the `toCommand` composition in `apps/cli/src/surfaces.ts`
  - Delete: unused projections and their matching tests after tracing the retained imports; unused compositions in `apps/cli/src/surfaces.ts`; the `catalog`, `openapi`, `serve`, and `mcp` commands in `apps/cli/src/command.ts`; `apps/cli/test/serve.test.ts` and the MCP and catalog cases in `apps/cli/test/cli.e2e.test.ts`
- **No code mode**:
  - Delete: `packages/capability/src/catalog.ts`, `packages/capability/src/code-mode.ts`, `packages/capability/src/sandbox-error.ts`, `packages/capability/src/sandbox-service.ts`, `packages/capability/src/sandbox-subprocess.ts`, and `packages/capability/src/to-code-mode.ts`; `packages/capability/test/catalog.test.ts`, `packages/capability/test/sandbox.test.ts`, `packages/capability/test/sandbox-lifetime.test.ts`, `packages/capability/test/sandbox-orphan.test.ts`, `packages/capability/scripts/sandbox-lifetime-proof.mjs`, and `packages/capability/test/to-code-mode.test.ts`; the `./sandbox` and `./code-mode` exports in `packages/capability/package.json`; `codeMode` and `mcpServer.codeMode` in `apps/cli/src/surfaces.ts`; the `catalog` command and the `--code-mode` flag in `apps/cli/src/command.ts`; the code-mode and catalog cases in `apps/cli/test/cli.e2e.test.ts`
- **No HTTP**:
  - Delete: `packages/capability/src/to-http-api.ts`, `packages/capability/src/http-api.ts`, and their tests; the `./http-api` export in `packages/capability/package.json`; `http`, `routes`, and `webServer` in `apps/cli/src/surfaces.ts`; the `openapi` and `serve` commands; `apps/cli/test/serve.test.ts`; the OpenAPI case in `apps/cli/test/cli.e2e.test.ts`
- **No MCP**:
  - Delete: `packages/capability/src/to-toolkit.ts`, `packages/capability/src/toolkit.ts`, their test, and `packages/capability/test/mcp-harness.ts`; the `./toolkit` export in `packages/capability/package.json`; `tools` and `mcpServer` in `apps/cli/src/surfaces.ts`; the `mcp` command; the MCP cases in `apps/cli/test/cli.e2e.test.ts`. Code mode imports from `packages/capability/src/to-toolkit.ts`, so cutting MCP cuts code mode too
- **Default flags only**:
  - Keep: Core's `Flags` port and declarations
  - Delete: Replace `apps/site/src/flags.ts` with core imports and `export const flagsLayer = Flags.defaults(eventFlags); export const liveFlagsLayer = flagsLayer;`; remove `packages/flags` and its dependency in `apps/site/package.json`. Readers use defaults; the CLI writer fails with a named read-only error
- **No analytics**:
  - Delete: `packages/events`; the `@rat-stack/events` line in `apps/site/package.json`
  - Change: the one line in `apps/site/src/events.ts` becomes `export { events, memoryEvents } from "@rat-stack/core/events-off";`
  - Then: `pnpm install`, `pnpm git-snapshot`, and the gate
  - Optional: `EVENTS_ENABLED`, `EVENTS_SINK_TOKEN`, and `EVENTS_IDENTITY_MODE` in `apps/site/.env.schema` and `apps/site/src/config-fingerprint.ts`, and the events flags in `packages/core/src/flags.ts`. The Worker ignores them once capture is off. Details: `packages/events/README.md`
- **No account auth or database (`auth` and `database`, with protected feedback and browser dev identity)**:
  - Delete: `packages/auth` and `packages/database`; their dependencies in `apps/site/package.json`, and `@rat-stack/auth` in `apps/web/package.json`; `apps/site/src/auth/{binding-client,foundation,infrastructure,private-capabilities,private-tag,private-worker}.ts` and `apps/site/test/feedback-auth.test.ts`
  - Delete: `apps/web/src/dev/{client,features,devtools}`, `apps/web/test/overlay.test.ts`, and `apps/web/test/overlay.scene.test.ts`; the recording case in `apps/web/test/dev-server.test.ts` and the development-build case in `apps/web/test/production-bundle.test.ts`. Keep its production no-leak check
  - Change: in `apps/site/src/worker.ts`, remove the `feedbackInfrastructure` import and call, and pass `undefined` in the feedback argument to `makeMischief`. Keep the unavailable feedback port in `auth/feedback-access.ts`; it cannot write feedback
  - Change: remove the `privateAuth` import and `AUTH_ENABLED` provider wrapper from `apps/infra/alchemy.run.ts`; remove `LearnFeedbackAuth` from the budget, entry, temporary-raise, and measurement lists in `apps/site/scripts/startup-budget.ts`, and remove its `feedbackAuthBuild` import
  - Change: replace `devtoolsRoutes` with `contentRoutes` from `./content-routes.js` in `apps/web/src/dev/backend.ts`; point the `development` condition of `#devtools-overlay` at `./src/client/no-devtools.ts`; remove `@rat-stack/devtools` from `apps/web/package.json`
  - Change: in `packages/core/test/boundaries-rule.test.ts`, remove the auth-only `testPeople` fixture; replace `authDistribution` with a `devtools` import from `@rat-stack/devtools/dist/index.js`, and `authBarrel` with a `packages/core/src` re-export from `@rat-stack/devtools`. Keep their refusal assertions. Remove auth test people from the allowed dev fixture
  - Change: in `apps/infra/test/provider-coverage.test.ts`, keep both events modes and every provider-registration assertion; remove the auth-mode loop and the assertions requiring `Drizzle.Schema` and `BetterAuth.Migrate`. Remove the two database excerpt fences from `.brain/resources/lore/scopes-own-resources.svx` and refer to its linked source instead
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`
  - Keep: the unused `AUTH_ENABLED` schema/fingerprint input can stay. `WEB_BOT_AUTH_ENABLED` and `WEB_BOT_AUTH_PRIVATE_JWK` protect a different interface; do not remove them with account auth. Never replace protected feedback with an unauthenticated writer
- **No devtools (keep the CLI and browser reader)**:
  - Delete: `packages/devtools`; its dependencies in `apps/cli/package.json`, `apps/web/package.json`, and `packages/auth/package.json`; `apps/web/src/dev/{client,features,devtools}`; `apps/web/test/overlay{,.scene}.test.ts`; `packages/auth/test/devtools.test.ts`, which tests recorder/identity integration
  - Change: in `apps/cli/src/surfaces.ts`, remove `DEVTOOLS_MCP_PATH`, `withDevtools`, `toolkitServer`, `devtoolsRoutes`, `devtoolsWebServer`, and `mcpServer.{devtools,devtoolsCodeMode}`; remove their `AnyCapability`, `Effect`, and recorder imports. In `apps/cli/src/command.ts`, remove `devtoolsFlag`, both `devtools` options and handler branches, the devtools URL log, and the `SERVE_HOST`/`DEVTOOLS_MCP_PATH`/`devtoolsWebServer` imports. `serve` becomes `({ port }) => Layer.launch(webServer(port))`; MCP still selects `mcpServer.codeMode` or `mcpServer.tools` through an expression arrow
  - Change: replace `devtoolsRoutes` with `contentRoutes` from `./content-routes.js` in `apps/web/src/dev/backend.ts`; point the `development` condition of `#devtools-overlay` at `./src/client/no-devtools.ts`
  - Change: remove only the recorder cases in `apps/cli/test/{serve,cli.e2e}.test.ts` and `apps/web/test/dev-server.test.ts`, and the development-build positive control in `apps/web/test/production-bundle.test.ts`. Remove the unused recorder and `devtoolsRoutes` imports and the `decodeDevtoolsCall` decoder; keep ordinary REST, MCP, RPC, and production no-leak checks
  - Change: in `packages/core/test/boundaries-rule.test.ts`, replace removed recorder fixtures with retained `@rat-stack/auth/devtools` test-person fixtures (`ratTestPerson as devtools`, and `typeof import("@rat-stack/auth/devtools").runAsPerson` for the type import). Drop the recorder from the allowed dev wiring fixture. Use `inspectFileContract` from `@rat-stack/core/contracts` for the browser-safe fixture and `inspectFile` from `@rat-stack/core` for the rejected browser-handler fixture. Keep every boundary assertion
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`
  - Optional: keep auth's unmounted test-person helpers and capability's no-op observer ports. Removing the recorder does not require deleting the ports used by handlers and machines
- **No live signup (`subscriber-delivery` and `intake-live`)**:
  - Delete: both packages and their dependencies in `apps/site/package.json`; `apps/site/src/interest/{applications,interest-durable-object,interest-index-durable-object}.ts`; `apps/cli/src/{join-interest,intake,intake-erase,intake-redeliver}.ts` and the three matching `intake*` CLI tests. Delete site tests `intake-applications{,-concurrency}`, `interest{,-capture}-runtime`, `join-interest`, `mcp-privacy`, and `page-ticket`, plus `apps/site/test/fixtures/interest{,-capture}-worker.ts`
  - Change: remove the `joinInterest` import and registration in `packages/core/src/inspect-file.ts` and `apps/site/src/capabilities/index.ts`. Remove `intakeCommand` from `apps/cli/src/command.ts`; remove `remoteJoinInterestLayer` and its provision from `apps/cli/src/cli.ts`. In `apps/cli/test/command.test.ts`, change the extra-subcommand count from `5` to `4`
  - Change: in `apps/site/src/worker.ts`, remove the signup imports; the `interestDirectory` and `agentSignup` parameters and arguments of `makeMischief`; the signup Config reads and `interestServices`, `interest`, `joinServices`, `applications`, `erasure`, and `redelivery` declarations; and `scheduleIntakeSweep`. Remove the `interest` and `joinTokens` route options and the `joinServices` provision. Remove the `Interest`/`InterestIndex` resources, `agentSignup` construction, and `CronEventSource` registration/provision. Keep capture, auth, flags, rate limits, sandbox, and reader wiring
  - Change: replace `apps/site/src/interest/page-ticket.ts` with the unavailable-page implementation below. In `worker-{runtime-init,events,error-pages}.test.ts`, remove `InterestDirectory` imports and `InterestDirectory.memory` arguments. Remove the `joinInterest` inventory expectations from `worker.test.ts`; make both inventory assertions in `interest.test.ts` exclude `joinInterest`. Remove only that file's two signup-UI cases, “offers the agent-only primary application control and no retired form or Shield” and “serves the approval card, five questions and ticket only to agents”, and their unused `copyPrompts`/`htmlTokens` imports. In `static-assets.test.ts`, remove the `IntakeTicket` import and `IntakeTicket.testLayer` provision; import `SIGNUP_UNAVAILABLE` from `../src/interest/page-ticket.js` and replace the fresh-ticket inequality with equal bodies containing that message. Keep its HEAD, validator, cache, and routing assertions
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`
  - Keep: the `INTEREST_*`, `DROVR_*`, `JOIN_DELIVERY_DEADLINE_SECONDS`, and `TYPESAFE_API_KEY` schema/fingerprint inputs remain declared. Core's ports and unmounted route/domain helpers also stay. This cut removes live resources and public signup capabilities, not every domain type; the workshop returns an unavailable signup message

  ```ts
  import { Effect } from "effect";

  export const SIGNUP_UNAVAILABLE =
    "Signup is temporarily unavailable; try again shortly.";

  const unavailableSignup = (body: string) =>
    body
      .replace(
        /The page ticket is:[\s\S]*?Do not claim they joined or received a seat from the submission response\./u,
        SIGNUP_UNAVAILABLE
      )
      .replaceAll("__INTAKE_PAGE_TICKET__", SIGNUP_UNAVAILABLE);

  export const withAvailablePageTicket = (body: string) =>
    Effect.succeed(unavailableSignup(body));
  ```

- **No deployment driver (`deploy` and `check-harness` together)**:
  - Delete: `packages/deploy`, `packages/check-harness`, `scripts/deploy-build.ts`, and `scripts/deploy-preview.sh`; the root `package.json` scripts `deploy:plan`, `deploy:prod`, `deploy:preview`, `deploy:preview:destroy`, `deploy:rollback`, and `state:copy`
  - Change: remove the three `packages/deploy` excerpt fences from `.brain/resources/lore/http-responses-need-validation.svx`; change “the in-memory fixture below” to “the in-memory fixture in the linked source”. Keep its historical source links
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`
  - Keep: `check-harness` while retaining `deploy`; deployment contracts, checks, receipts, and machines import its verdicts. This cut removes the deployment driver, rollback receipts, preview driver, and state-copy command; it does not remove `apps/infra` or run a deployment
- **No cloud stack (`infra`, after the deployment-driver cut)**:
  - Delete: `apps/infra`; the root `package.json` scripts `alchemy`, `infra:deploy`, `infra:destroy`, `infra:dev`, and `infra:plan`; the `apps/infra/alchemy.run.ts` excerpt fences in `skills/learn-rat-stack/SKILL.md` and `skills/learn-alchemy/SKILL.md`
  - Change: replace `apps/infra/package.json` with `apps/site/package.json` in `apps/site/scripts/generate-content.ts`, `apps/site/scripts/migration-inputs.ts`, `apps/site/test/component-registry.test.ts`, and the `ALCHEMY_VERSION` read in `scripts/vendor-agent-sources.sh`. The site already pins the same Alchemy version. Change that script's source-pin explanation from `apps/infra` to `apps/site`
  - Change: in `packages/core/test/boundaries-rule.test.ts`, replace the `@rat-stack/infra` browser-import fixture with `../../../../infra/alchemy.run.ts`. Keep its rejection assertion; the deleted package alias no longer resolves, but the reserved infra-path boundary still applies
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`; `bash -n scripts/vendor-agent-sources.sh` checks the adapted source-fetch script. This combined cut removes `infra`, `deploy`, and `check-harness`; it leaves the Worker declarations and content build available without a deployment Stack
- **No CLI (keep browser devtools and hosted interfaces)**:
  - Delete: `apps/cli`, `.github/workflows/ratstack-publish.yml`, and the root `package.json` script `cli`. This also removes the published `ratstack` bin
  - Change: in `scripts/acceptance-cold-clone.sh`, wrap the CLI help, HTTP, MCP, and catalog smoke steps after the full gate in `if [[ -f apps/cli/package.json ]]; then` … `fi`. Keep cold install, workspace rename, capability registration, and the full gate; they still apply without the CLI
  - Change: remove all `apps/cli` excerpt fences from `skills/learn-rat-stack/SKILL.md` and `.brain/resources/lore/{structure-effect-by-domain,one-schema-three-surfaces,layers-make-dependencies-explicit,error-model,effect-basics}.svx`. Keep historical source links. In `apps/site/test/worker.test.ts`, keep `packages/core/src/inspect-file.ts` as the pinned-excerpt link fixture and remove only `apps/cli/src/surfaces.ts` from that path list
  - Then: `pnpm install`, `pnpm git-snapshot`, and `pnpm turbo run check test build`; `bash -n scripts/acceptance-cold-clone.sh` checks the adapted shell script
  - Optional: keep `packages/devtools` for the browser overlay. Keeping HTTP, MCP, and code mode in Mischief does not require the local CLI
- **Keep `lore` with the hosted content graph**: `apps/site/src/content-store.ts` builds its graph through `LoreGraph`; `apps/site/scripts/generate-content.ts` consumes its graph schemas. Cutting the package without replacing those callers loses graph-backed content queries and the content build. Remove the graph feature first; this is not an independent package cut
- **Keep `code-snippets` with the teaching-content build**: `apps/site/scripts/{code-pipeline,generate-content,git-snapshot,doc-fences}.ts` use its schemas, source adapters, and excerpt pipeline. Cutting it loses source-checked excerpts, snapshot generation, and documentation-fence checks. Replace that pipeline before deleting the package
- **Keep `web` with the shared reader build**: `apps/site/scripts/reader-*-flags.ts` and `reader-body-document.ts` import reader models, document nodes, and templates from `apps/web`; `generate-content.ts` imports its page copy. `apps/infra/alchemy.run.ts` also composes `Website` and the `WEBSITE` binding. Cutting `apps/web` loses the browser reader and breaks hosted-content generation, not just UI deployment. Separate those shared build inputs first
- **Keep `mischief` (`apps/site`) with the hosted content product**: `apps/web/src/dev/backend.ts` imports its content capabilities and Node layer; `apps/web/src/website.ts` imports its RPC workers. `apps/web/scripts/reader-build.ts` imports its reader-input generators, and `apps/web/package.json` runs its content generator before development. The infra Stack imports its workers. Cutting `apps/site` loses the hosted tools and the reader's generated content/backend. Extract or replace those pieces before deleting the app
- **No XState (only after removing interest and every other lifecycle except file inspection)**:
  - Keep: Keep XState and its bridge while any retained lifecycle imports them
  - Delete: `packages/core/src/inspect-machine.ts` and its test (call `FileInspector.inspect` directly from `packages/core/src/inspect-file.ts`); `xstate` and `@xstate/effect` in `packages/core/package.json` and their `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`; the compiled `@xstate/effect/oxlint` plugin registration and `xstate-effect/no-inline-effect` rule in `oxlint.config.ts`

`defineContract`, `implement`, and `toCommand` are the minimum that keep `stats` working. The contract module has no dependency on the other projections.

## License

MIT
