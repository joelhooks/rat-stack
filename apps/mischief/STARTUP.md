# Mischief startup budget

Run the portable size gate from the repository root:

```sh
pnpm --filter @rat-stack/mischief typecheck
```

It generates content, typechecks, and builds the production Worker with the installed Alchemy `WorkerBundle`. It does not import the Stack, plan infrastructure, upload a Worker, or require cloud credentials. The entry must stay below **10,000,000 uncompressed bytes**. Both `pnpm check` and `pnpm turbo run check test build` reach this check through Mischief's typecheck.

## Profile locally

With Wrangler on PATH:

```sh
WRANGLER_SEND_METRICS=false pnpm --filter @rat-stack/mischief startup:profile
```

Validated with Wrangler 4.94.0. This runs `wrangler check startup --worker` against a multipart bundle assembled from **Alchemy's output**, not an esbuild substitute. Wrangler imports the bundle in local workerd under the V8 CPU profiler. Open `apps/mischief/dist/startup/worker.cpuprofile` in Chrome DevTools. The directory also contains the JavaScript chunks, hidden source maps, and Rolldown's `analysis.json`.

The harness uses Alchemy's defaults: ESM, minification, preserved names, pure annotations, runtime defines, Cloudflare plugins, and strict execution order. Its production virtual entry exports the `Interest`, `InterestIndex`, and `LegacyMcp` bridges. The placeholder constructor values only tell the virtual-entry generator which names are Durable Objects; application constructors remain in `worker.ts`. The stack metadata is `RatStack` / `prod`, with compatibility date `2026-05-28` and `nodejs_compat`.

Keep those names, compatibility settings, and stack metadata aligned with `worker.ts`, the Durable Object declarations, and `apps/infra/alchemy.run.ts` when they change. The internal Alchemy import is tied to the exact installed pin; review it on an Alchemy bump.

## Measured baseline

On Flagg, against `9efd0b1`, five local workerd profiles gave:

| Measure                            |       Main | Deferred OG decoding |
| ---------------------------------- | ---------: | -------------------: |
| Entry bytes                        |  9,572,869 |            9,572,878 |
| All JavaScript chunks              | 10,951,398 |           10,951,407 |
| Median profile elapsed             | 348.085 ms |           243.184 ms |
| Median sampled time excluding idle | 276.503 ms |           171.342 ms |

The change defers OG PNG base64 decoding from module evaluation into each image route's request Effect. It removes about 89 ms of sampled work attributed to `app.ts` during initialization. The existing static-response cache still serves subsequent image requests without decoding; a cache miss pays for decoding only its requested image. This is not a claim that total decoding work disappears.

All 212 public/static paths were fetched with both HTML and Markdown negotiation. The 424 responses had identical body SHA-256, length, status, and headers before and after. No content or image bytes moved to another storage system.

## Why this budget

The 10,000,000-byte threshold leaves 427,122 bytes (4.46%) above the measured entry. Startup had already failed intermittently in production, so generous growth headroom would defeat the gate. This is an early regression alarm, not Cloudflare's compressed-upload limit and not a proof that a deployment will start successfully.

There is deliberately no portable millisecond gate. Wrangler's alpha profiler samples a dynamically imported Worker during a local request. Profile elapsed time includes idle/inspector time, and sampled non-idle time is an estimate, not Cloudflare's startup CPU accounting. CPUs, runner load, V8 versions, and sampling vary. Use repeat profiles on the same host for comparisons; require calibrated runners and an empty-worker control before making milliseconds a CI threshold.

## Next size reduction

Generated content accounts for roughly 8.90 MB of the entry by source-map attribution. Moving it into static assets would remove much more code than deferring evaluation. That is a separate slice: emit immutable HTML, Markdown, and image assets keyed by the existing content version; make the content adapter fetch only the requested representation; retain content metadata for search/lore capabilities; wire the assets binding at composition; then compare every public representation, headers, status, and body bytes against the current Worker. Do not substitute KV or R2 without accepting their infrastructure, latency, and consistency costs.
