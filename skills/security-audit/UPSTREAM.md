# Upstream

Vendored from [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/tree/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8) at commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.

MIT licensed. Copyright (c) 2025-2026 Cloudflare, Inc. The full notice is in `LICENSE`.

The entry point `SKILL.md` is adapted for defensive review. The other upstream files are unchanged. `LICENSE` is copied from the upstream root. `RAT-STACK.md` and this file are local additions.

## Take upstream fixes

1. Fetch the proposed upstream revision into a separate checkout.
2. Compare its `skills/security-audit/` and root `LICENSE` with this pinned revision.
3. Review the diff before replacing the upstream files here. Preserve the local additions.
4. Record the new full commit here and in `PROVENANCE.md`.
5. Run `pnpm test:security-audit` and `pnpm turbo run check test build --concurrency=4`.
6. Compare `pnpm --filter @rat-stack/site startup:check` before and after. Skill content belongs in static assets.

## Integration

The website, well-known indexes, and MCP servers publish the defensive entry point and its approved companions: the license, upstream credit, boundary map, and report schema. The publisher selects these paths before reading their bytes. The other files in this directory are not part of the published bundle.

The root lint and format configs exclude this vendored directory, following the scoped lint exclusion for `tools/oxlint/anti-slop/`. No rule severity changes. `pnpm test:security-audit` runs the unmodified Node validator suites without new dependencies; `pnpm test` includes it.
