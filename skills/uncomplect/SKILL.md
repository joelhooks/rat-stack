---
name: uncomplect
description: Find what a rat-stack design braids together, separate it into capabilities, cartridges, machines, features, and clients, and fence the separation so the next change cannot braid it again. Use when asked to simplify, review, or replace a design, "what would Rich Hickey do", "optimize for deletion", or "define this error out of existence".
basis:
  - https://github.com/joelhooks/skills/tree/main/skills/uncomplect
---

# Uncomplect rat-stack

Preserve proven behavior, not accidental structure. Separate concerns, then make the separation hold under the next change. Rich Hickey's _Simple Made Easy_ (2011) distinguishes simplicity from familiarity.

Greg Young's _The Art of Destroying Software_ argues for replaceable programs. Optimise for deletion, not predicted requirements.

## Read first

Read `AGENTS.md`, `VISION.md`, and the relevant `.brain/` decisions. Inspect the design's source, tests, and runtime receipts. Check library APIs against matching pinned sources before changing Effect, XState, or Alchemy code. Every recommendation must name its source file, preserved behavior, deleted complexity, and fence.

## Find the braids

### Behavior in a projection

- **Spot it:** Domain decisions inside `packages/capability/src/to-*.ts`, or separate handlers for HTTP, MCP, CLI, and RPC.
- **Split it:** Put behavior in a capability handler. Copy `packages/core/src/inspect-file.ts` and its contract in `packages/core/src/contracts.ts`.
- **Fence it:** `rat-stack-boundaries/no-cross-layer-imports` blocks capability-package imports of core. `rat-stack-boundaries/no-hand-rolled-surface` restricts surface constructors. Neither detects every misplaced decision. **No fence yet** for behavioral parity; candidate: a cross-surface property over one capability.

### Transport in a feature

- **Spot it:** `fetch`, RPC construction, or retries inside `apps/web/src/features/**`.
- **Split it:** Move transport into a client under `apps/web/src/client/`. Copy `apps/web/src/client/docs.ts`; features read atoms and call named commands.
- **Fence it:** `rat-stack-boundaries/no-feature-transport` blocks feature transport. `rat-stack-boundaries/no-browser-server-imports` keeps handler imports outside browser modules.

### Vendor in a caller

- **Spot it:** Drizzle queries, SQL dialects, or provider SDK calls outside their cartridge.
- **Split it:** Call a service port. Copy `packages/database/src/run-log.ts` and the vendor Layer in `packages/database/src/d1.ts`. Subscriber adapters live in `packages/subscriber-delivery/`, outside core.
- **Fence it:** `rat-stack-boundaries/no-core-adapters` blocks provider adapters in core. **No fence yet** for all callers; candidate: a vendor-import boundary rule.

### Infrastructure apart from its user

- **Spot it:** A database or queue declared separately from the Layer that consumes its binding.
- **Split it:** Let the cartridge declare resources and bindings. Copy `packages/database/src/d1.ts`; provide its Layer at composition.
- **Fence it:** Alchemy binding requirements give a type seam. **No fence yet** proving removal; candidate: a cartridge-removal compile check.

### Stack wiring in runtime code

- **Spot it:** Runtime imports of `apps/infra`, or resource work triggered by importing `apps/infra/alchemy.run.ts`.
- **Split it:** Keep Stack composition in `apps/infra/alchemy.run.ts`. Keep runtime behavior in capabilities and cartridge Layers.
- **Fence it:** `rat-stack-boundaries/no-cross-layer-imports` rejects imports of `apps/infra` from elsewhere. **No fence yet** for import purity; candidate: an import-without-deployment test.

### Policy in mechanism

- **Spot it:** Approval checks repeated inside handlers, or retry rules mixed with domain refusal.
- **Split it:** Set `needsApproval` on the contract. Copy the gate in `packages/capability/src/implement.ts`. Put transient retry policy in the boundary service or machine.
- **Fence it:** The capability type adds `Approval` and `ApprovalDenied`. `packages/capability/test/to-rpc.test.ts` checks the gate and reserves its failure. **No fence yet** for arbitrary retry policy; candidate: a retry-history model test.

### Lifecycle in domain data and boolean soup

- **Spot it:** Status strings and booleans encode modes, retries, cancellation, or legal event sequences.
- **Split it:** Use a machine under `packages/core/src/`. Copy `packages/core/src/inspect-machine.ts`. Declare `fromEffect` actors; start only with `createEffectActor`.
- **Fence it:** `xstate-effect/no-inline-effect` and `rat-stack-patterns/watch-effect-actors` guard actor wiring. `packages/core/test/inspect-machine.model.test.ts` checks histories. **No fence yet** banning ordinary actor startup; candidate: an Effect-machine startup rule.

### Two authorities

- **Spot it:** A cache or client replica decides a mutation independently of the Durable Object or database cartridge.
- **Split it:** Keep the server authoritative. Clients in `apps/web/src/client/` reconcile through `reactivityKeys`. Copy the contract-derived client in `apps/web/src/client/docs.ts` for reads. Call a DDD projection a read model; rat-stack projections expose capabilities.
- **Fence it:** **No fence yet** proving reconciliation or sole authority; candidate: a stale-replica command-sequence model test.

### Ceremony service

- **Spot it:** A `Context.Service` and Layer hide one implementation, no dependencies, and no test double.
- **Split it:** Use a plain function; copy `summarizeText` in `packages/core/src/stats.ts`. An earned service captures dependencies; copy `packages/core/src/file-inspector.ts` when that seam exists.
- **Fence it:** **No fence yet** measuring whether a service earns its seam. Candidate: a project rule requiring hidden dependencies or replaceable behavior.

### Unparsed boundary

- **Spot it:** `unknown`, `JSON.parse`, or assertions carry untrusted edge values into domain code.
- **Split it:** Decode with Effect Schema at the boundary. Copy the schemas in `packages/core/src/contracts.ts`; give handlers parsed inputs.
- **Fence it:** `anti-slop/no-unknown-parameters`, `anti-slop/no-unknown-returns`, and `anti-slop/require-safety-comment-for-type-assertion` constrain escape paths. They do not prove decoding. **No fence yet** for every raw parse; candidate: a boundary-decode property over malformed inputs.

### Crash folded into an outcome

- **Spot it:** `onError`, `catchAll`, or cause recovery erases the distinction between refusal and broken execution. Check what each handler actually catches.
- **Split it:** Keep expected outcomes typed and propagate defects. Copy `packages/core/src/join-delivery-machine.ts`; the machine leaves crashed delivery owed, not settled.
- **Fence it:** `packages/core/test/join-delivery-machine.model.test.ts` checks crash histories. The seam property in `packages/core/test/join-interest.test.ts` keeps crashed contacts ready for redrive. **No fence yet** for other machines; candidate: lint `onError` transitions targeting final states.

PR #9 (`37b8ba9`) removed `onError: { target: "settled" }`. A first-attempt crash had stored `refused` permanently. The fix propagates the crash and leaves the contact owed.

### Duplicated wire descriptions

- **Spot it:** A hand-written route, tool, command, or schema repeats a capability's wire contract.
- **Split it:** Define one contract in the capability owner's package. Copy `packages/core/src/contracts.ts`; use the projections in `packages/capability/src/to-*.ts`.
- **Fence it:** `rat-stack-boundaries/no-hand-rolled-surface` restricts constructors. `rat-stack-patterns/contract-binding-matches-name` keeps contract bindings aligned with names.

### Config versus runtime switch

- **Spot it:** Deploy-only values live in callers, or a switch requiring immediate changes needs a deployment.
- **Split it:** Put deploy-only values in `AppConfig`, using `packages/core/src/config-service.ts`, `packages/core/src/app-config.ts`, and `.env.schema`. A live switch needs a flag. Rat-stack has no flags cartridge yet.
- **Fence it:** `packages/core/test/app-config.test.ts` checks config parsing. **No fence yet** for flags; candidate: reject flag reads outside their Layer when the cartridge arrives.

### Deploy env as hidden input

- **Spot it:** The same code produces resource deletes when deploy-shell configuration is absent.
- **Split it:** Declare deploy inputs in `.env.schema`; run `pnpm env:check`. Keep resource use in cartridge Layers, as in `packages/events/src/basin.ts`.
- **Fence it:** AGENTS requires sign-off for plan deletions and replacements. **No fence yet** proving shell-independent plans; candidate: compare resource actions with required deploy configuration present and absent.

On 2026-10-04, missing `EVENTS_*` deploy configuration produced three analytics deletes without a code change. Schema validation alone cannot prove the intended resource footprint. Read the plan before applying it.

## Deepen the seam

A capability hides schemas, behavior, approval, and projections. A cartridge hides a vendor and its infrastructure.

For each proposed tag, Layer, or state, name what it removes. For consequential changes, compare two signatures. Choose the one requiring less caller knowledge while preserving failures and behavior.

## Run the cartridge test

Apply `VISION.md`'s test: labeled, pushes in, pulls out, self-contained, and easy to trash.

1. In an isolated checkout, remove the package and its composition line. Run `pnpm turbo run check test build`.
2. Check that callers use its public seam, not internals.
3. Ask whether its schemas, tests, and receipts support replacement within about one week.

The week is a pressure test, not a rule for splitting services.

## Fence the separation

Use the highest rung that holds: types and APIs, then lint and behavior tests, then project rules.

1. Follow `gardener`: add a rule before cleaning up the pattern. Plant a bug before trusting a new property.
2. Verify existing names in `oxlint.config.ts`, `scripts/oxlint-plugin-*.ts`, and `packages/*/test/`.
3. Mark missing coverage **No fence yet**. Label candidates; do not present them as shipped rules.

## Output

Lead with `More complicated locally, simpler overall` or `More machinery, no net simplification`. Give each braid's source, preserved behavior, smallest seam, deleted complexity, and existing fence or candidate. Include the signature, any machine, cartridge-test result, deletion list, and one material question. State what becomes impossible, what becomes obvious, and what disappears.
