# Provenance

| What | Origin | Notes |
| --- | --- | --- |
| Dependency pins, `pnpm-workspace.yaml` release-age exclusions, `tsconfig.json` compiler options, `.oxfmtrc.json` settings, `LICENSE` | [rat-stack](https://github.com/joelhooks/rat-stack) at `2a22d18` (MIT) | Trimmed to one package. No apps, deploy, varlock, Alchemy, Turborepo or site. The Effect language-service diagnostics and rat-stack's custom oxlint plugins are not carried over; `.oxlintrc.json` uses oxlint's built-in rules. The oxfmt settings follow Ultracite's preset as rat-stack uses it. |
| `.pi/settings.json` package | [pi-until](https://github.com/joelhooks/pi-until) at `bf7abfe` (PR #19's merge) | Installed by Pi from the pinned commit, not copied. `bf7abfe` drops the consumer npm floor, so a stock npm install prints no `EBADDEVENGINES` warning. |
