---
name: uncomplect
description: Find responsibilities that a rat-stack design combines, separate them into capabilities, cartridges, machines, features, and clients, and enforce that separation through types and checks. Use when asked to simplify, review, or replace a design, "what would Rich Hickey do", "optimize for deletion", or "define this error out of existence".
basis:
  - https://github.com/joelhooks/skills/tree/main/skills/uncomplect
---

# Uncomplect rat-stack

Uncomplect means separate responsibilities that currently change together. Preserve behavior proved by tests or runtime observations. Replace structure that combines unrelated responsibilities. Make the separation hold under the next change.

Rich Hickey's _Simple Made Easy_ (2011) distinguishes simplicity from familiarity.

Greg Young's _The Art of Destroying Software_ argues for replaceable programs. Optimise for deletion.

## Read first

Read `AGENTS.md`, `VISION.md`, and the relevant `.brain/` decisions. Inspect the design's source, tests, and recorded runtime results. Check library APIs against matching pinned sources before changing Effect, XState, or Alchemy code. Every recommendation must name its source file, preserved behavior, deleted complexity, and enforced check.

## Terms used here

| Term | Meaning |
| --- | --- |
| Capability | One named action with a contract and a server-side handler. |
| Contract | The shared name, input, output, failures, metadata, and approval setting. |
| Projection | An interface built from capabilities: a command, API, or agent tool. |
| Cartridge | A package that owns one job and its resources. It must pass the add-and-remove test below. |
| Fence | Types, lint rules, tests, and hooks that reject prohibited changes. Project rules cover remaining gaps. |
| Effect | The library for describing work with typed failures and required services. |
| Service | A named interface for one job. A service tag identifies the service requested by a caller. |
| Schema | A definition of accepted values that provides TypeScript types and runtime checks. |
| Layer | A description of how to construct services and supply their dependencies. |
| Alchemy Stack | The infrastructure program that declares cloud resources and their connections. |
| Binding | A connection that gives runtime code access to a resource. |
| Machine | Named states, events, and legal transitions for one lifecycle, defined with XState. |
| Actor | A running unit of work used by a machine. |
| Feature | A thin route and view that read client state and call named commands. |
| Client | The module that owns queries, commands, and a local copy of server data. |
| Port | An interface for an application job, independent of a provider. |
| Adapter | An implementation of a port for a particular provider. |

CLI means command-line interface. MCP lets agents discover and call tools. RPC lets a client call named server operations.

Atoms hold observable client values. A property test checks a rule across generated inputs. A model test checks stateful rules across generated command sequences.

## Find combined responsibilities

### Behavior in a projection

- Look for domain decisions inside `packages/capability/src/to-*.ts`, or separate handlers for HTTP, MCP, CLI, and RPC.
- Put behavior in a capability handler. Copy `packages/core/src/inspect-file.ts` and its contract in `packages/core/src/contracts.ts`.
- `rat-stack-boundaries/no-cross-layer-imports` blocks capability-package imports of core. `rat-stack-boundaries/no-hand-rolled-surface` restricts interface constructors. Neither detects every misplaced decision. **No fence yet** proving that interfaces behave alike; candidate: a property test that compares one capability's results across interfaces.

### Network calls and retries in a feature

- Look for `fetch`, RPC construction, or retries inside `apps/web/src/features/**`.
- Move network calls and retries into a client under `apps/web/src/client/`. Copy `apps/web/src/client/docs.ts`; features read atoms and call named commands.
- `rat-stack-boundaries/no-feature-transport` blocks network calls in features. `rat-stack-boundaries/no-browser-server-imports` keeps handler imports outside browser modules.

### Provider code in a caller

- Look for Drizzle queries, SQL dialects, or provider SDK calls outside their cartridge.
- Call the application's port. Copy `packages/database/src/run-log.ts` and the provider Layer in `packages/database/src/d1.ts`. Subscriber adapters live in `packages/subscriber-delivery/`, outside core.
- `rat-stack-boundaries/no-core-adapters` blocks provider adapters in core. **No fence yet** for all callers; candidate: a rule that restricts provider imports.

### Resources separate from the code that uses them

- Look for a database or queue declared separately from the Layer that consumes its binding.
- Let the cartridge declare resources and bindings. Copy `packages/database/src/d1.ts`; provide its Layer where the application selects and connects service implementations.
- Alchemy binding requirements let types check resource dependencies. **No fence yet** proving safe removal; candidate: a cartridge-removal compile check.

### Infrastructure setup in runtime code

- Look for runtime imports of `apps/infra`, or resource work triggered by importing `apps/infra/alchemy.run.ts`.
- Keep Alchemy Stack setup in `apps/infra/alchemy.run.ts`. Keep runtime behavior in capabilities and cartridge Layers.
- `rat-stack-boundaries/no-cross-layer-imports` rejects imports of `apps/infra` from elsewhere. **No fence yet** proving that imports do not deploy resources; candidate: an import-without-deployment test.

### Approval and retry rules inside handlers

- Look for approval checks repeated inside handlers, or retry rules mixed with domain refusal.
- Set `needsApproval` on the contract. Copy the gate in `packages/capability/src/implement.ts`. Put rules for retrying temporary failures in the service that handles external calls, or in the machine.
- The capability type adds `Approval` and `ApprovalDenied`. `packages/capability/test/to-rpc.test.ts` checks the gate and reserves its failure. **No fence yet** for arbitrary retry policy; candidate: a retry-history model test.

### Lifecycle encoded in scattered flags

- Look for status strings and booleans that encode modes, retries, cancellation, or legal event sequences.
- Use a machine under `packages/core/src/`. Copy `packages/core/src/inspect-machine.ts`. Declare `fromEffect` actors; start only with `createEffectActor`.
- `xstate-effect/no-inline-effect` and `rat-stack-patterns/watch-effect-actors` check how actors are declared and observed. `packages/core/test/inspect-machine.model.test.ts` checks histories. **No fence yet** banning ordinary actor startup; candidate: an Effect-machine startup rule.

### Two places approving writes

- Look for a cache or local copy of server data that decides a mutation independently of the Durable Object or database cartridge.
- Keep the server authoritative. Clients in `apps/web/src/client/` update their local copies through `reactivityKeys`. Copy the contract-derived client in `apps/web/src/client/docs.ts` for reads. In domain-driven design (DDD), a read model is derived data arranged for queries. A rat-stack projection instead exposes capabilities through an interface.
- **No fence yet** proving that local copies update correctly or that only the server approves writes. Candidate: a model test over command sequences with an outdated local copy.

### Service wrapper that hides nothing

- Look for a `Context.Service` and Layer that hide one implementation, no dependencies, and no replacement implementation for tests.
- Use a plain function; copy `summarizeText` in `packages/core/src/stats.ts`. Use a service when it hides dependencies or replaceable behavior. Copy `packages/core/src/file-inspector.ts` when it must capture dependencies.
- **No fence yet** checking whether a service hides useful dependencies or behavior. Candidate: a project rule requiring hidden dependencies or replaceable behavior.

### Unchecked external input

- Look for `unknown`, `JSON.parse`, or assertions that carry untrusted external values into domain code.
- Decode with Effect Schema at the boundary. Copy the schemas in `packages/core/src/contracts.ts`; give handlers parsed inputs.
- `anti-slop/no-unknown-parameters`, `anti-slop/no-unknown-returns`, and `anti-slop/require-safety-comment-for-type-assertion` restrict ways to bypass type checks. They do not prove decoding. **No fence yet** for every raw parse; candidate: a boundary-decode property over malformed inputs.

### Crash folded into an outcome

- Look for `onError`, `catchAll`, or cause recovery that erases the distinction between refusal and broken execution. Check what each handler catches.
- Keep expected outcomes in declared types. Propagate defects: unexpected execution failures. Copy `packages/core/src/join-delivery-machine.ts`; the machine leaves crashed delivery pending.
- `packages/core/test/join-delivery-machine.model.test.ts` checks crash histories. The integration property in `packages/core/test/join-interest.test.ts` keeps crashed contacts ready for another delivery attempt. **No fence yet** for other machines; candidate: lint `onError` transitions targeting final states.

PR #9 (`37b8ba9`) removed `onError: { target: "settled" }`. A first-attempt crash had stored `refused` permanently. The fix propagates the crash and leaves contact delivery pending.

### Duplicated API definitions

- Look for a hand-written route, tool, command, or schema that repeats a capability's input, output, or failure definitions.
- Define one contract in the capability owner's package. Copy `packages/core/src/contracts.ts`; use the projections in `packages/capability/src/to-*.ts`.
- `rat-stack-boundaries/no-hand-rolled-surface` restricts constructors. `rat-stack-patterns/contract-binding-matches-name` keeps contract bindings aligned with names.

### Deployment configuration or live flag

- Look for deploy-only values in callers, or a switch that requires immediate changes but needs a deployment.
- Put deploy-only values in `AppConfig`, using `packages/core/src/config-service.ts`, `packages/core/src/app-config.ts`, and `.env.schema`. A live switch needs a flag: a value that controls whether behavior is enabled. Rat-stack has no flags cartridge yet.
- `packages/core/test/app-config.test.ts` checks config parsing. **No fence yet** for flags; candidate: reject flag reads outside their Layer when the cartridge arrives.

### Undeclared deployment inputs

- Look for resource deletes caused by configuration missing from the shell that runs deployment with unchanged code.
- Declare deployment inputs in `.env.schema`; run `pnpm env:check`. Keep resource use in cartridge Layers, as in `packages/events/src/basin.ts`.
- AGENTS requires sign-off for plan deletions and replacements. **No fence yet** proving that plans do not depend on undeclared shell values; candidate: compare resource actions with required deploy configuration present and absent.

On 2026-10-04, missing `EVENTS_*` deployment configuration produced three analytics deletes without a code change. Schema validation alone cannot prove the intended set of resources. Read the plan before applying it.

## Hide implementation details behind the interface

A capability hides schemas, behavior, approval, and projections. A cartridge hides its provider implementation and resources.

For each proposed service tag, Layer, or state, name what it removes. For consequential changes, compare two function signatures: their inputs, outputs, failures, and required services. Choose the one requiring less caller knowledge while preserving failures and behavior.

## Run the cartridge test

Apply `VISION.md`'s cartridge test:

- The package has one named job.
- Add or remove one package and its Layer or Alchemy Stack line.
- The package owns its job and resources.
- The package is easy to delete and replace.

1. In an isolated checkout, remove the package and the line that provides its Layer or adds its resources to the Alchemy Stack. Run `pnpm turbo run check test build`.
2. Check that callers use its public interface, not internal implementation details.
3. Ask whether its schemas, tests, and recorded runtime results support replacement within about one week.

Use the week to pressure-test replacement. Keep each service responsible for its named job.

## Enforce the separation

Use the strongest available check: types and APIs first, then lint and behavior tests, then project rules.

1. Follow `gardener`: add a rule before cleaning up the pattern. Plant a bug before trusting a new property.
2. Verify existing names in `oxlint.config.ts`, `scripts/oxlint-plugin-*.ts`, and `packages/*/test/`.
3. Mark missing coverage **No fence yet**. Label candidates; do not present them as shipped rules.

## Output

Lead with `More complicated locally, simpler overall` or `More machinery, no net simplification`. Give each combined responsibility's source, preserved behavior, smallest interface, deleted complexity, and existing check or proposed check. Include the signature, any machine, cartridge-test result, deletion list, and one material question. State what becomes impossible, what becomes obvious, and what disappears.
