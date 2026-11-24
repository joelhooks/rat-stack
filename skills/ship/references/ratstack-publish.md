# Publish the ratstack package

Follow [ship](/skills/ship) for the release procedure. This reference owns the `ratstack` npm publish rules.

- `.github/workflows/ratstack-publish.yml` publishes `ratstack` to npm with trusted publishing (OIDC). No npm token exists in the repo or its secrets.
- Bump `apps/cli/npm/ratstack/package.json` and `apps/cli/src/version.ts` together. The e2e test fails when they differ.
- Merge to `main`, then push the tag `ratstack-v<version>` on that merged commit. The workflow refuses a tag that does not match the version or is not on `main`.
- The workflow runs the full gate, then `npm publish` from `apps/cli/dist/npm`. npm adds provenance.
- The npm package settings name this repo, `ratstack-publish.yml`, and the `npm` environment as the trusted publisher. Changing the workflow filename breaks publishing.
