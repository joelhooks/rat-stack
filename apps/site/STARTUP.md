# Mischief startup budget

Run the portable size gate from the repository root:

```sh
pnpm --filter @rat-stack/mischief typecheck
```

It generates content, typechecks, and builds the production Worker with Alchemy's `WorkerBundle`. It does not import the Stack, plan infrastructure, upload a Worker, or require cloud credentials. The limits are **900,000 uncompressed entry bytes** and **2,500,000 total JavaScript bytes**. Both `pnpm check` and `pnpm turbo run check test build` reach this gate.

## Page count no longer sets bundle size

The generated module contains fixed document, interest, error, and email shells plus the generation identifier. Page sources, search records, the lore graph, glossary, indexes, route metadata, and image metadata live in generation-addressed static assets.

`ContentStore` reads those assets. The Worker adapter uses ASSETS; the Node adapter reads the same generation from `dist/content`. Mischief and the private RpcBackend declare the same generation directory. Both use the existing manifest guard during planning. A generation mismatch fails before deployment.

Successful catalog, search, graph, and MCP-registration loads are memoized per service instance and generation. Failures are not retained. Constructors do not read assets. There is no inline content fallback.

| Capability | Cold asset fetches | Warm asset fetches |
| --- | --: | --: |
| `search` | 1 search index | 0 |
| `read` | 1 catalog + 1 page | 1 page |
| `backlinks`, `neighbors`, `mentions`, `path` | 1 shared graph | 0 |
| Resource listing and route matching | 1 shared catalog | 0 |

The graph methods share one cache. A known page with a missing, corrupt, or mismatched asset fails with `AssetReadError`; HTTP returns 503 with `no-store`. An unknown page still fails with `ResourceNotFound`.

## Profile locally

With Wrangler on PATH:

```sh
WRANGLER_SEND_METRICS=false pnpm --filter @rat-stack/mischief startup:profile
```

Validated with Wrangler 4.94.0. This runs `wrangler check startup --worker` against a multipart bundle assembled from Alchemy's output, not an esbuild substitute. Wrangler imports the bundle in local workerd under the V8 CPU profiler. Open `apps/mischief/dist/startup/worker.cpuprofile` in Chrome DevTools. The directory also contains JavaScript chunks, source maps, and Rolldown's `analysis.json`.

The harness uses Alchemy's defaults: ESM, minification, preserved names, pure annotations, runtime defines, Cloudflare plugins, and strict execution order. Its production virtual entry exports the `Interest`, `InterestIndex`, and `LegacyMcp` bridges. Placeholder constructor values tell the virtual-entry generator which names are Durable Objects; application constructors remain in `worker.ts`. The stack metadata is `RatStack` / `prod`, with compatibility date `2026-05-28` and `nodejs_compat`.

Keep those names, compatibility settings, and stack metadata aligned with `worker.ts`, the Durable Object declarations, and `apps/infra/alchemy.run.ts`. The internal Alchemy import follows the exact installed pin; review it on an Alchemy bump.

## Size proof and headroom

The pre-extraction entry was **3,090,009 bytes**, with **4,470,503 total JavaScript bytes**. Extraction reduced the entry to **822,362 entry bytes** and **2,205,180 total JavaScript bytes**. The entry gate leaves **77,638 bytes**: 9.44% above the entry, or 8.63% of the limit. The total-JavaScript gate leaves **294,820 bytes**: 13.37% above measured JavaScript, or 11.79% of the limit.

Adding 15 synthetic lore pages changed the emitted page count from 111 to 126. Entry size stayed exactly **813,559 bytes**. The generated bootstrap stayed **104,026 bytes**. The temporary pages were removed and the normal generation restored. Subsequent main changes brought the fixed bootstrap to **104,861 bytes**.

Frozen old/new capability comparisons covered **7,698 cases with zero mismatches**, including every original read id and all 7,225 graph path pairs. A permanent fixture preserves representative results for every content capability. Local Worker Loader tests exercise `search → read → backlinks` against the same assets as Node.

## Timing is evidence, not a gate

One pre-extraction local profile measured 157.219 ms elapsed and 111.866 ms sampled non-idle time. Three final post-extraction profiles measured 119.051–195.458 ms elapsed and 79.202–148.417 ms sampled non-idle time. Their medians were 120.926 ms and 80.337 ms.

In initialized local workerd with the asset service primed, cold content-cache requests took 26 ms for search and 12 ms for read. Warm requests took 4 ms each. The readiness probe took 2,207 ms; an earlier unprimed first search took 4,221 ms. These include local development plumbing, not just capability execution.

Main also gained identity validation and observability changes during this slice; this is not an isolated CPU benchmark.

There is deliberately no portable millisecond gate. Wrangler's alpha profiler samples a dynamically imported Worker during a local request. Elapsed time includes inspector and idle time; sampled non-idle time is not Cloudflare's startup CPU accounting. CPUs, runner load, V8 versions, and sampling vary. Use profiles on the same host for comparisons, and calibrate runners against an empty-worker control before making milliseconds a CI threshold.

The byte thresholds are regression alarms, not Cloudflare's compressed-upload limit and not proof that a deployment will start successfully. Live startup and parity remain deployment checks.
