# Open Graph cards

`@rat-stack/og` renders a title, description, and rat emoji into a 1200×630 PNG. It owns the card layout, fonts, emoji, and `ogImagePath`. The `/coverage` export checks social metadata and PNG headers without loading either rendering engine.

Import it only from build scripts. `apps/site/scripts/generate-content.ts` renders cards and checks the export and sitemap routes. `apps/web/scripts/reader-build.ts` checks Foldkit’s prerender manifest against the emitted HTML and the PNGs it copies. Workers serve the generated PNGs; they never run Satori or resvg.

## Keep or cut

To keep cards, register the page’s title and description in `apps/site/scripts/generate-content.ts`. The route lists come from the export, sitemap, and Foldkit, so a missing card fails the build. Add only non-HTML routes, with a reason, to the exclusions in `apps/site/scripts/og-route-gate.ts`.

To cut cards, remove card rendering and the gate calls from the site generator and reader build. Remove the OG and Twitter image tags from `apps/site/scripts/document-html.ts` and `apps/web/src/reader-metadata.ts`, and remove the card paths from the reader descriptors, asset copy, and smoke checks. Keep the site icons by pointing the icon build at static assets before deleting this package and its workspace entry in `apps/site/package.json`. Refresh the lockfile and run `pnpm turbo run check test build --summarize`.
