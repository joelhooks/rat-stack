# Provenance

rat-stack bans comments in code (see AGENTS.md). Credit for borrowed code lives here instead.

| Code | Origin | Notes |
| --- | --- | --- |
| `packages/core/test/layer-composition.test.ts`, `packages/core/test/fixtures/layer-composition/` | [effect-solutions](https://github.com/kitlangton/effect-solutions/blob/09f82e6c5c928e7232cd32daf04d7c6a830b63f7/packages/website/docs/04-services-and-layers.md) | adapted from effect-solutions by Kit Langton (MIT) @ 09f82e6. The same-instance versus separate-instance example becomes a counted-construction fixture with independently written services. |
| `scripts/oxlint-plugin-xstate-effect.ts` | [statelyai/xstate](https://github.com/statelyai/xstate) `scripts/oxlint-plugin-xstate-effect.mjs` at `xstate@6.0.0-alpha.58` (commit `0748e1b`), MIT | Ported onto the typed `@oxlint/plugins` API with the same behavior. Diff the logic against upstream when refreshing. |
| `scripts/oxlint-plugin-effect-tests.ts` | [t3code](https://github.com/pingdotgg/t3code) `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts` | Adapted. |
| `packages/core/src/config-service.ts` | [opencode](https://github.com/sst/opencode) `packages/opencode/src/effect/config-service.ts` | Pattern moved onto the Effect 4 API. |
| `packages/capability/src/catalog.ts` | Executor's kernel IR and Cloudflare's Code Mode | Types for the code-mode `tools` object are generated from JSON Schema, never from Effect internals. |
| `packages/capability/test/mcp-harness.ts` | Effect's own `McpServer` tests | The server layer becomes a web handler; a fetch shim keeps the session headers. |
| `packages/capability/src/sandbox-subprocess.ts`, `packages/capability/test/sandbox-orphan.test.ts`, VM-timeout cases in `packages/capability/test/sandbox.test.ts` | ported from a downstream fix to the vendored capability package |  |
| `tools/oxlint/anti-slop/` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22`, MIT | Vendored and owned; see `UPSTREAM.md` there. Its files keep upstream's comments. |
| `apps/mischief/src/house-ad.svelte` | [Heroicons](https://heroicons.com) v2 24px outline `arrow-right`, MIT, Copyright (c) Tailwind Labs, Inc. | The arrow path is inlined as SVG; the package is not a dependency. |
| `apps/mischief/src/copy-prompt.svelte` | [Hugeicons](https://hugeicons.com) `@hugeicons/core-free-icons@4.3.5`, `Tick02Icon`, MIT, Copyright (c) 2025 Hugeicons | The checkmark path is inlined as SVG; the package is not a dependency. |

## Local deployment driver

`packages/check-harness`, the service-port shape in `packages/deploy/src/deploy-runner.ts`, and `skills/ship` are ported from drovr (badass-courses), commit `6bfe63508539ee289564c4ef6a5768e26dca60b7`.

Source paths: `packages/check-harness`, `packages/release-train/src/services/deploy-runner.ts`, `packages/release-train/src/services/alchemy-release.ts`, and `skills/ship`.

The port removes project-specific orchestration. Deployment policy, the local Alchemy adapter and rat-stack smoke checks are new here.

## Lucide bot icon (ISC)

The inline bot SVG in `apps/mischief/src/copy-prompt.svelte` comes from [Lucide's bot icon](https://github.com/lucide-icons/lucide/blob/main/icons/bot.svg).

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Media

| File | Origin | Notes |
| --- | --- | --- |
| `apps/mischief/content/tokenmaxx/snes-sfam-cartridges.jpg` | [Evan-Amos, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:SNES-SFAM-Cartridges.jpg), [public domain (PD-self)](https://commons.wikimedia.org/wiki/Template:PD-self) | Photograph of a Super NES cartridge above a Super Famicom cartridge, 13 October 2011. Author's worldwide public-domain release verified on the Commons file page. Resized from 3720 × 1980 to 1400 × 745, JPEG quality 85; metadata stripped. Served at `/lore/cartridges/snes-sfam-cartridges.jpg`. |

## Rule limits worth knowing

`xstate-effect/no-inline-effect` flags an Effect created inside an inline enqueue callback or passed inline to `enq.spawn(...)`. It matches the enqueue parameter by name (`enq` or `enqueue`) and recognizes an Effect only by its root identifier `Effect`. So `enq(() => Effect.log("x"))` is reported, but an Effect from a helper (`enq(() => makeEffect())`), a renamed namespace import, or a `Stream` or `Layer` root is not. Widening it needs type information. | `scripts/oxlint-plugin-patterns.ts`, `no-hand-rolled-surface` and `no-browser-globals-on-server` in `scripts/oxlint-plugin-boundaries.ts` | [foldkit/foldkit](https://github.com/foldkit/foldkit) `packages/oxlint-plugin-foldkit` at `95fed7f`, MIT | Rule ideas translated to rat-stack's nouns and rewritten on `@oxlint/plugins`; no code copied. Mapping in `.brain/projects/rat-devtools.svx`. | | `packages/devtools` | [foldkit/foldkit](https://github.com/foldkit/foldkit) `packages/devtools-mcp` at `95fed7f`, MIT | Tool shapes, path alphabet, and summary format follow Foldkit's devtools MCP; the implementation is ours. |
