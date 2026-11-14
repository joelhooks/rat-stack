# Project context

Pi appends this file to its system prompt for sessions in this repo. A child project rewrites this section on day one; what follows describes rat-stack itself.

- `typecheck` and `check` run `effect-tsrs diagnostics --strict --type-check`, so TypeScript errors and Effect errors and warnings fail. Patched `tsc` runs through `typecheck:tsc` and `typecheck:parity` on checker bumps, not on every CI run. Report any checker disagreement. `AGENTS.md` owns every version number; read it there, not here.
- Agent edit loop: `pnpm typecheck:fast` runs plain tsrs for fast feedback. It has no Effect diagnostics; use `typecheck` or `check` for those.
- Validation gate: `pnpm turbo run check test build`. Lefthook runs `pnpm check` and `pnpm test` on commit; CI runs the full gate on a cold cache.
- Domain terms: a **capability** (a contract from `defineContract` bound to a handler with `implement`) is one named, schema-typed behavior; a **projection** (`packages/capability`) turns capabilities into a CLI command, an HTTP API, an MCP toolkit, or code mode; the **fence** is the type-aware lint, Effect language-service diagnostics, and hooks that make bypasses fail loudly.
- Active constraint: XState 6 and `@xstate/effect` move together; bump them as a pair. Invoked Effect errors carry `EffectFailure<E>`; preserve `event.error.cause` and lift it with `Effect.failCause`. Use the compiled `@xstate/effect/oxlint` rule at error severity.
- Current focus: rat-stack is a reference, not a template. Keep a fresh clone working: a cold `pnpm install` and the full gate must pass.

## Brain procedures

`.brain/` is the agent-connected project brain (PARA: projects, areas, resources, archives).

- Organize by usefulness — ask: where will this be useful next?
- Keep notes atomic, linked, source-grounded, authored as `.svx`.
- Capture only durable decisions, terms, tradeoffs, gotchas, sources, questions, and review feedback.
- Refine captures into graph edges, backlinks, summaries, and canonical concepts.
- Express knowledge as code, docs, decisions, UI, issues, or plans. Storage is not the goal; output is.
- No PKM ceremony, no append-only logs as truth, no generic static-site sludge.
