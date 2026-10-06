# Keep the stack floor intact

**Applies when:** choosing runtimes, infrastructure, or validation.

Use the stack and pins declared in AGENTS.md. Treat its fence as part of the implementation, not optional cleanup.

**Why:** A predictable environment catches shortcuts before another project copies them.

**Example:** `tsconfig.base.json` makes Effect diagnostics errors; `package.json` patches the compiler during prepare.

**Held by:** `packages/core/test/docs-pins.test.ts`; `packages/core/test/vcs-command-policy.test.ts`; `pnpm turbo run check test build`.

Read [Effect basics](/lore/effect-basics) and the [domain reading map](/lore/structure-effect-by-domain) for checked Effect 4 idioms.
