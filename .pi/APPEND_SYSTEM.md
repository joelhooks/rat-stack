# Project context

Pi appends this file to its system prompt for sessions in this repo. A child project rewrites this section on day one; what follows describes rat-stack itself.

- Repo law lives in `AGENTS.md`; product intent in `VISION.md`. Read both before substantial work.
- Validation gate: `pnpm turbo run check test build`. Lefthook runs `pnpm check` and `pnpm test` on commit; CI runs the full gate on a cold cache.
- Domain terms: a **capability** binds a schema-typed `defineContract` to a server handler with `implement`; a **projection** (`packages/capability`) exposes it as CLI, HTTP, MCP, RPC, or code mode; the **fence** makes bypasses fail loudly through typed lint, Effect diagnostics, and hooks.
- `apps/web` uses Foldkit Model → Message → `update` → Command → contract-derived RpcClient. Only `update` writes browser state. Server and domain lifecycles remain XState. Browser DevTools may ship; server devtools and `src/dev` never reach production.
- Active constraint: `xstate` and `@xstate/effect` are alpha pins (`6.0.0-alpha.63`, `0.1.0-alpha.6`) with matching `minimumReleaseAgeExclude` entries; bump them together, and read `vendor/README.md` before vendoring anything.
- Current focus: keep the template instantiable. Any change must survive `gh repo create <name> --template joelhooks/rat-stack` followed by a cold `pnpm install` and the full gate.

## Brain procedures

`.brain/` is the agent-connected project brain (PARA: projects, areas, resources, archives).

- Organize by usefulness — ask: where will this be useful next?
- Keep notes atomic, linked, source-grounded, authored as `.svx`.
- Capture only durable decisions, terms, tradeoffs, gotchas, sources, questions, and review feedback.
- Refine captures into graph edges, backlinks, summaries, and canonical concepts.
- Express knowledge as code, docs, decisions, UI, issues, or plans. Storage is not the goal; output is.
- No PKM ceremony, no append-only logs as truth, no generic static-site sludge.
