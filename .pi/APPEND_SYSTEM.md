# Project context

Pi appends this file to its system prompt for sessions in this repo. A child project rewrites this section on day one; what follows describes rat-stack itself.

- `typecheck` and `check` run `@yielded/effect-tsrs` `0.2.3` with `--strict --type-check`, so TypeScript errors and Effect errors and warnings fail. Without `--type-check`, this version checks only Effect diagnostics. It bundles tsrs `8f135f106a63`, contained in plain tsrs `0.20.0`. Patched TypeScript `7.0.2` / `@effect/tsgo` `0.55.0` runs through `typecheck:tsc` and `typecheck:parity` at the switch and on checker bumps, not on every CI run. Report any checker disagreement.
- Agent edit loop: `pnpm typecheck:fast` keeps plain tsrs `0.20.1-ts7.1.0-beta`, targeting TypeScript `7.1.0-beta`. It still has no Effect diagnostics; use `typecheck` or `check` for those.
- Validation gate: `pnpm turbo run check test build`. Lefthook runs `pnpm check` and `pnpm test` on commit; CI runs the full gate on a cold cache.
- Domain terms: a **capability** (`defineCapability` in `packages/core`) is one named, schema-typed behavior; a **projection** (`packages/capability`) turns capabilities into a CLI command, an HTTP API, an MCP toolkit, or code mode; the **fence** is the type-aware lint, Effect language-service diagnostics, and hooks that make bypasses fail loudly.
- Active constraint: XState `6.0.0-alpha.71` and `@xstate/effect` `1.0.0-alpha.10` move together. Invoked Effect errors carry `EffectFailure<E>`; preserve `event.error.cause` and lift it with `Effect.failCause`. Use the compiled `@xstate/effect/oxlint` rule at error severity. `AGENTS.md` owns the Stack contract.
- Current focus: keep the template instantiable. Any change must survive `gh repo create <name> --template joelhooks/rat-stack` followed by a cold `pnpm install` and the full gate.

## Brain procedures

`.brain/` is the agent-connected project brain (PARA: projects, areas, resources, archives).

- Organize by usefulness — ask: where will this be useful next?
- Keep notes atomic, linked, source-grounded, authored as `.svx`.
- Capture only durable decisions, terms, tradeoffs, gotchas, sources, questions, and review feedback.
- Refine captures into graph edges, backlinks, summaries, and canonical concepts.
- Express knowledge as code, docs, decisions, UI, issues, or plans. Storage is not the goal; output is.
- No PKM ceremony, no append-only logs as truth, no generic static-site sludge.
