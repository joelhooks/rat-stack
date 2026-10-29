# Vendored packages

Keep pinned dependencies here until npm publishes them. Each entry records its build source and removal condition. Nothing is vendored right now. One published package carries a pnpm patch.

The current `xstate@6.0.0-alpha.71` and `@xstate/effect@1.0.0-alpha.10` pins come from npm. Their exact `minimumReleaseAgeExclude` entries move together. The bridge accepts Effect `^4.0.0`, XState `^6.0.0-alpha.71`, and optional `@oxlint/plugins` `^1.76.0`. Its compiled `@xstate/effect/oxlint` export supplies `xstate-effect/no-inline-effect` at error severity.

- **Vendored packages**: none.
- **Patched packages**:
  - `@foldkit/vite-plugin@0.28.0`, through `patchedDependencies` in `pnpm-workspace.yaml` and `patches/@foldkit__vite-plugin@0.28.0.patch`. The patch changes one line in `dist/index.js`: the DevTools [MCP](/lore/mcp-is-another-surface) relay id calls `crypto.randomUUIDv4()`. Effect 4.0.3 made `Crypto.randomUUIDv4` a function, so the published `.pipe` call throws and the relay never starts.
  - The `peerDependencyRules.allowedVersions` entries for `foldkit`, `@foldkit/ui`, `@foldkit/devtools`, `@foldkit/vite-plugin`, and `@foldkit/markdown` travel with it. Those packages peer on exact Effect `4.0.0`; the repo runs `4.0.7`.
  - Remove both when Foldkit publishes a `@foldkit/vite-plugin` that calls `randomUUIDv4()` and peers that accept Effect `4.0.7`. Bump to that version, delete the patch file, its `patchedDependencies` entry, and the allowed versions, run `pnpm install`, and check that the dev server logs `MCP relay listening`.

The last one was `xstate-effect-0.1.0-alpha.2.tgz`, built from the `statelyai/xstate` tag `xstate@6.0.0-alpha.58` with `pnpm exec preconstruct build && pnpm pack` after the first npm publish failed on 2026-09-17. npm published the same bytes on 2026-09-19 and `packages/core` moved to the registry version on 2026-09-20.

## Rules for the next one

- Add a `file:` spec in the consuming package, the tarball here, and a list entry above with the exact tag or commit it was built from. Build from a pinned tag to keep lockfile integrity reproducible. A moving branch cannot provide that guarantee.
- A `file:` tarball still goes through pnpm's release-age check, which looks the version up on the registry. An unpublished version 404s and fails `pnpm install --frozen-lockfile` in CI; a warm local metadata cache hides this. Every vendored tarball needs a matching version-scoped `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml`.
- When the version publishes, confirm the tarballs match (`npm pack <name>@<version>` and compare file lists and `dist`), replace the `file:` spec with the exact version, delete the tarball and its list entry, run `pnpm install`, and watch CI. Keep the `minimumReleaseAgeExclude` entry if the package is a prerelease pin like the others in that list.
