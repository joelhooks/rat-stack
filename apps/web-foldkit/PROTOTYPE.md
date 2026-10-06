# Foldkit prototype

**Recommendation: switch once we settle UI lifecycle law and production DevTools policy. Do not replace `apps/web` yet.**

Search and read use the existing contracts and `/rpc` backend. Browser navigation, cold reads, failures, and home-page SSG work. Nothing is deployed.

## Run it

1. Run `pnpm install --frozen-lockfile`.
2. Start `apps/web` with portless name `foldkit-backend` and command `./node_modules/.bin/vite dev`.
3. Start this app with portless name `foldkit-prototype` and the same command.
4. Search for `capability`. Open `One capability, every surface`.
5. Run `pnpm --filter @rat-stack/web-foldkit build:ssg` for the optional static home page.

The Vite proxy points `/rpc` at the named backend. Use the app-local Vite binary, not the workspace-root binary.

The server remains the content authority. Foldkit's Model holds a disposable browser replica. `update` is its only writer.

## Effort

| Comparable scope                                          | Files | Lines |
| --------------------------------------------------------- | ----: | ----: |
| Foldkit features, Model, Commands, router, browser entry  |     5 |   431 |
| Current read/search, docs client, two page routes, router |     6 |   248 |
| Current scope plus root shell, RPC route, devtools route  |     9 |   351 |
| Current React devtools overlay alone                      |     1 |   402 |

Counts exclude CSS, generated route trees, tests, and configuration. The prototype adds 14 files before this report, including SSG and tests.

Foldkit is more explicit, not fewer lines. Model schemas, navigation Commands, request generations, and result Messages replace hooks and AtomRpc's cache behavior.

The harder seams were DevTools module identity and the Promise-based SSG host entry. No contract or handler changed.

The client opens a scoped RPC client per request. It does not implement AtomRpc's 30-second search cache or document cache.

Generation checks reject late results. This prototype does not cancel superseded requests or restore scroll positions.

## Evidence

- Browser search returns ten real matches. The first is `ratstack://lore/one-capability-every-surface`, score 86.
- Opening that result renders its title, description, and full lore text at `/read?id=…`.
- Eight tests cover input-to-results, read routing, both failure views, cold reads, blank input, schema preservation, and stale results.
- Tests use `foldkit/scene` and `foldkit/story`. Version 0.166.0 has no `foldkit/test` export.
- The all-Message property generates Models and Messages from Effect schemas. It also checks that update preserves its input.
- Mutation proof reverses the read-generation comparison. The read Scene and stale-result property both fail; restoring it passes all eight tests.
- SSG emits `dist/ssg/client/index.html` with the heading, labelled form, and idle status already rendered.
- The preview hydrates that HTML and searches the real backend. No browser errors appear.
- A production source-map build contains no backend handlers, `@foldkit/devtools` overlay, or `@foldkit/ui` modules.
- It still includes `foldkit/dist/devTools/store.js` and `submodelPath.js`. Disabled recording is not code removal.

The normal build clears `dist`, including optional SSG output. Run `build:ssg` last when reviewing SSG.

## DevTools

Do not port the 402-line overlay wholesale. Foldkit DevTools shows browser Models, Messages, Commands, Mounts, and time travel.

Locally, its panel shows `SubmittedSearch`, `SucceededSearch`, the loaded Model, and a session scrubber. The MCP relay also returns that Model.

The relay was exercised directly with the same `RequestListRuntimes` and `RequestGetModel` frames used by DevTools MCP. No persistent MCP installation was added.

Foldkit does not replace rat-stack's server capability catalog, recorded server calls, replay/diff, actor watch, or test-person switching. Keep those capabilities and build a small Foldkit inspector for them.

A local Vite plugin removes two forced optimizer includes: `@foldkit/devtools/vite` and `foldkit/devtools-host`. It also excludes DevTools, UI, and the host from prebundling.

Without that adjustment, the injected host uses a prebundled Foldkit copy while the app uses unbundled Foldkit. The MCP runtime connects, but the overlay never appears. There is no console error. With one copy, the panel appears.

Source: Foldkit `packages/vite-plugin-foldkit/src/devToolsOverlay.ts`; published plugin 0.26.1 forces those imports into `optimizeDeps.include`.

## Fit with repo law

| Rule | Result |
| --- | --- |
| Capability-only transport | Pass. Commands call `RpcClient` over `toRpcGroup([searchContract, readContract])`. No new endpoint or handler exists. |
| Browser imports | Pass. Existing `apps/*/src/client/**` and `features/**` globs cover this app. No glob change. |
| No module-level mutable state | Pass for our code. Foldkit does not require application globals. Its own HTML builder has a shared frame stack. |
| XState lifecycles | Unresolved policy conflict. Pure update is a transition function, not an XState actor. Commands run Effects directly, not `fromEffect` actors. |
| No comments | Pass except one explained diagnostic directive at the SSG host boundary. |
| Effect diagnostics | Browser code passes without overrides. The Promise-based server entry requires the targeted `asyncFunction` override below. |
| Anti-slop | Pass after using Schema guards, readable spacing, and distinct type aliases. |

Keep domain lifecycles in XState. Decide whether browser replicas may use Foldkit update before rewriting the blueprint. Foldkit's experimental Machine supplies transition tables, not XState actor lifetimes, hierarchy, or the Effect bridge. Do not run two owners for one lifecycle.

Exact initial fence output included:

```text
error eslint(no-redeclare): 'Model' is already defined.
error eslint(no-redeclare): 'Message' is already defined.
error anti-slop-effect(no-manual-tag-comparison): Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.
error TS377081: This code declares an async function, consider representing this async control flow with Effect values and `Effect.gen`. effect(asyncFunction)
```

The type aliases are now `AppModel`, `AppMessage`, and `AppRouteState`. Schema guards replace manual tag comparisons.

The only override is `@effect-diagnostics-next-line asyncFunction:off` in `src/entry.server.ts`. Foldkit's Vite host requires `Promise<EntryResult>`; the render itself remains an Effect.

No lint, hook, or diagnostics configuration changed. `@foldkit/oxlint-plugin` 0.15.2 was inspected but not installed. Its convention preset is not part of this proof. Add an app-scoped configuration in a real migration, without replacing our fence.

## Workers and rendering

Concurrent requests in one isolate cannot interleave Foldkit's synchronous view bracket under the inspected implementation.

At Foldkit revision `6bd9ee8e`, `packages/foldkit/src/html/runtimeSingleton.ts:35` owns the shared frame stack. `setRuntime` pushes at lines 61–75; `clearRuntime` pops at lines 122–131.

`packages/foldkit/src/experimental/server/server.ts:1238–1250` brackets `view` with push and `finally` cleanup. No await or Effect yield occurs inside that bracket. `renderToString` calls it at line 1446.

A concurrent Effect may yield before or after the bracket. It cannot suspend the synchronous view halfway through. Duplicate module copies remain a separate failure risk.

SSG avoids request-time rendering entirely. Our SSG proof renders only the empty search page; it does not fetch or pre-render every document.

Alchemy 2.0.0-beta.80 explicitly documents Foldkit SPAs in `src/Cloudflare/Website/Vite.ts:125–138`. Its `Website.Foldkit` adapter supplies SPA fallback by default.

`Website.Vite` can serve these browser assets with `notFoundHandling: "single-page-application"`. It still needs a Worker `/rpc` forwarder to the existing private backend. Merely binding `BACKEND` does not create that route.

Foldkit's SSR build also emits a Web `fetch` handler. Worker execution and Cloudflare-plugin composition were not deployed or runtime-tested here.

## Bundle and churn

Both builds use Vite 8.0.7 and Effect 4.0.0. Values sum emitted browser assets; they are not first-navigation transfer measurements.

| Browser output              | JavaScript |   Gzip JS |     CSS | Gzip CSS |
| --------------------------- | ---------: | --------: | ------: | -------: |
| Current app, all six chunks |  532.20 kB | 176.02 kB | 9.04 kB |  2.67 kB |
| Foldkit SPA, one chunk      |  356.51 kB | 116.33 kB | 0.71 kB |  0.43 kB |

Foldkit saves about 34% of gzip JavaScript here. It ships less styling and lacks the current shell and cache behavior. This is not a complete migration benchmark.

The last ten changelog releases are 0.166.0 through 0.158.1. Eight are minors; two are patches. Each minor changes an API contract or required peer version.

Examples: 0.166 changes lifted readers; 0.165 requires stable Effect; 0.164 requires rc.117; 0.163 renames event mappers and `evo`; 0.162 renames key bindings. 0.161 changes Command records, 0.160 restricts `Command.mapEffect`, and 0.159 changes SSR delivery and exports. The two patches concern documentation/build publication.

Sources: Foldkit `packages/foldkit/CHANGELOG.md:3–676` and npm's exact published manifests. Budget for coordinated Foldkit, DevTools, plugin, and Effect upgrades.

The rendered app uses native forms, buttons, links, headings, labelled input, live status, and alerts. Scene role queries exercise those semantics. Keyboard focus has the required pink ring. Read content remains plain text, matching the current app. Screen-reader, axe, and full keyboard audits remain unproven.

## Migration cut list

1. Remove React, React DOM, scheduler, Atom React, TanStack Start/Router, React Vite plugin, and React type packages from the web app.
2. Add exact Foldkit, platform-browser, Vite plugin, DevTools, and an app-scoped Foldkit Oxlint plugin. Keep Effect and server cartridges.
3. Replace the web feature blueprint with feature → named Foldkit Command → contract-derived RpcClient → shared capability. Model owns the replica; update writes it; view owns no transport.
4. Keep XState for server/domain lifecycles. Record an explicit decision for browser-only UI transitions.
5. Replace React seam tests with Scenes, Stories, and generated Message histories. Keep backend/projection behavior tests.
6. Extend the production-bundle test to reject the overlay, server handlers, test people, and server devtools. Decide whether Foldkit's included but disabled core DevTools violates the existing standard.
7. Preserve the `/rpc` Worker forwarder, SPA fallback, cache/scroll behavior, and a separate inspector over rat-stack devtools capabilities.
8. Prefer SSG for public entry pages until Worker SSR is proven with the intended deployment plugin.

## Validation

`pnpm turbo run check test build --concurrency=1` passes: 62 successful tasks. The app's eight tests pass. Browser, SSG, DevTools relay, mutation, and production-module checks are recorded above. All owned local servers are stopped after proof.

Release-age exceptions added by pnpm: `foldkit@0.166.0`, `@foldkit/vite-plugin@0.26.1`, and `@foldkit/devtools@0.166.0`. Existing pins remain unchanged.
