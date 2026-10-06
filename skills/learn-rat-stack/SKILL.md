---
name: learn-rat-stack
updated: "2026-10-06"
description: Trace a capability through Effect, XState, five projections, the CLI, and Alchemy. Try hosted search and read.
---

# Learn the stack

Start with one [capability](/systems/capabilities): `inspectFile`. Follow its [contract](/systems/capabilities), handler, service, machine, and [projections](/lore/one-capability-every-surface). Then try the hosted content tools.

Read [Effect basics](/lore/effect-basics) before this trace if the computation model is new. For implementation tasks, use [services](/lore/services-capture-dependencies), [Layer composition](/lore/layers-make-dependencies-explicit), and [testing](/lore/tests-that-earn-their-place).

## The pieces

- Effect supplies schemas, services, typed errors, and Layers.
- XState owns finite lifecycles. The Effect bridge runs their declared actors.
- TypeScript 7 and Effect diagnostics check types and Effect usage.
- Oxlint, Oxfmt, Vitest, and lefthook enforce [the fence](/lore/the-fence).
- pnpm and Turborepo connect packages and cache checks.
- Alchemy declares the cloud. Follow [learn Alchemy](/skills/learn-alchemy) for the deployment graph.

**What to notice:** Each piece has a job. The pinned examples below show their connections.

## One action, five surfaces

```text
                     ┌─ CLI
                     ├─ HTTP
One Capability ──────┼─ MCP
                     ├─ code mode
                     └─ RPC
```

A [projection](/lore/one-capability-every-surface) exposes the same action through another interface. RPC serves browser clients. [Code mode](/lore/one-program-can-replace-several-tool-calls) lets agents compose calls in one program.

**What to notice:** The diagram shows interfaces, not five separate handlers.

## Trace one action

These excerpts pin the code to `5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b` on the repository's main branch. The CLI uses `inspectFile`. The hosted site uses a separate content registry.

### 1. Define the contract

The [contract](/systems/capabilities) names the action and its input, output, and failure schemas.

```ts repo=rat-stack path=packages/core/src/contracts.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=155-163 {155,158-163}

```

**What to notice:** `FileStatsError` belongs to the interface. The annotations mark a repeatable, read-only action.

### 2. Bind one handler

`implement` binds the contract to `runInspectMachine`. The registry includes the resulting [capability](/systems/capabilities).

```ts repo=rat-stack path=packages/core/src/inspect-file.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=7-11 {7-9,11}

```

**What to notice:** The handler starts a machine. It does not read the file itself.

### 3. Put file work in a service

`FileInspector.make` captures the file system. Its `inspect` method reads bytes and maps file errors to `FileStatsError`.

```ts repo=rat-stack path=packages/core/src/file-inspector.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=14-29 {15,20-24,28}

```

The service exposes its [Layer](/lore/layer-constructor-pattern) beside the implementation. This follows [hexagonal architecture](/lore/hexagonal-architecture): composition supplies the file-system dependency.

```ts repo=rat-stack path=packages/core/src/file-inspector.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=31-35 {34}

```

**What to notice:** Callers ask the service to inspect a path. They do not choose a file-system implementation.

### 4. Give the lifecycle named states

A declared `fromEffect` actor calls `FileInspector`.

```ts repo=rat-stack path=packages/core/src/inspect-machine.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=26-30 {26,28}

```

The machine starts in `reading`. It finishes in `inspected` or `unreadable`.

```ts repo=rat-stack path=packages/core/src/inspect-machine.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=40-64 {40,43,51,57,59,62}

```

**What to notice:** Success and failure are states. The declared actor owns the file read.

### 5. Project the registered actions

The CLI's server surfaces use the same `capabilities` list.

```ts repo=rat-stack path=apps/cli/src/surfaces.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=21-32 {21,23,25,29}

```

The RPC [projection](/lore/one-capability-every-surface) derives contracts from its supplied capabilities.

```ts repo=rat-stack path=packages/capability/src/to-rpc.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=24-27 {24,27}

```

**What to notice:** A projection takes a registry. It does not require another domain handler.

### 6. Wire the CLI

`toCommand` derives each command. `inspectFile` also gets the `stats` alias.

```ts repo=rat-stack path=apps/cli/src/command.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=20-30 {23-27}

```

The entry point supplies the service [Layer](/lore/layer-constructor-pattern) and Node services. It denies [approval](/systems/capabilities) by default.

```ts repo=rat-stack path=apps/cli/src/cli.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=16-22 {18,20}

```

**What to notice:** Composition provides dependencies. The command keeps the shared handler.

### 7. Compose the cloud

Alchemy declares the Stack, Cloudflare providers, and state. The Stack includes `Mischief` and `Website`.

```ts repo=rat-stack path=apps/infra/alchemy.run.ts at=5c0f78e03d69ff9ea00f6b95d02cc36a3de91a0b lines=12-18,114-119 {12,15-16,114-115}

```

**What to notice:** This is cloud composition, not a deployment of the Node file-inspection CLI.

## Try hosted search and read

Use [POST /api/execute](/llms.txt#run-code-one-program-instead-of-several-calls) for [code mode](/lore/one-program-can-replace-several-tool-calls). The [agent guide](/llms.txt) documents this search → read program:

```js
const found = await tools.search({ query: "cartridges", limit: 1 });
const page = await tools.read({ id: found.matches[0].id });
return { title: page.title, id: page.id };
```

Send it as a JSON `code` string:

```sh
curl --request POST 'https://ratstack.sh/api/execute' \
  --header 'content-type: application/json' \
  --data '{"code":"const found = await tools.search({ query: \"cartridges\", limit: 1 }); const page = await tools.read({ id: found.matches[0].id }); return { title: page.title, id: page.id };"}'
```

**What to notice:** `read` takes the exact ID from `search`. This hosted program reads content, not local files.

## Read before changing a piece

1. Read [`AGENTS.md`](/AGENTS.md) for pins, boundaries, and [the fence](/lore/the-fence).
2. Read [VISION.md](/VISION.md) for intent.
3. Read the package you plan to change.
4. Before Effect or XState work, read `node_modules/effect/AGENTS.md` and the pinned sources listed in repo law.

In a copied product repo, replace the template's product notes and rules. Keep the stack lessons that still serve the product.

**What to notice:** Repo law and pinned code win over a stale example.

## Pick the next skill

- Add schemas and a shared action: [`add-a-capability`](/skills/add-a-capability).
- Model a lifecycle: [add a lifecycle machine](/skills/add-a-lifecycle-machine).
- Remove a surface: [keep or cut](/skills/keep-or-cut).
- Follow the cloud footprint: [learn Alchemy](/skills/learn-alchemy).

**What to notice:** Pick the skill for the boundary you plan to change.

## Finish

Run the full gate:

```sh
pnpm turbo run check test build
```

Fix failures. Keep [the fence](/lore/the-fence) intact.

**What to notice:** A passing gate is the check, not a claim that the cloud was deployed.
