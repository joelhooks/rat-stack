# Mischief startup budget

Run the portable size gate from the repository root:

```sh
pnpm --filter @rat-stack/site typecheck
```

It generates content, typechecks, and builds production Workers with Alchemy's `WorkerBundle`. It does not import the Stack, plan infrastructure, upload a Worker, or require cloud credentials.

The hard, shrink-only ceilings cover the **static startup set**: **1,114,000 bytes for Mischief** and **628,000 bytes for LearnFeedbackAuth**, and **870,000 bytes for Workshop**. Lower a ceiling when code shrinks. Never raise it to accept growth. LearnFeedbackAuth's temporary raise has been retired; see [Request-time D1 auth](#request-time-d1-auth). Both `pnpm check` and `pnpm turbo run check test build` reach this gate.

The harness starts at the upload's entry module and follows only static imports in Rolldown's `analysis.json`. It sums actual uploaded JavaScript bytes, including the entry, once per module. Shared chunks and cycles count once. Dynamic imports and their exclusively reachable dependencies do not count. Missing static graph or upload evidence fails with `StartupGraphInvalid`; inspect the graph and rebuild.

Entry bytes and total JavaScript bytes remain logged measurements. Total JavaScript above **2,500,000 bytes** emits a warning, never a size failure. Page sources, search records, and graph data are static assets outside the JavaScript upload. Their growth does not block this gate. Fixed document shells remain startup code when statically imported. Do not inline growing content data into startup code.

`dist/startup/metrics.json`, `dist/startup-auth/metrics.json`, and `dist/startup-workshop/metrics.json` record entry bytes, startup bytes, the counted filenames, total JavaScript bytes, and ceilings. Metrics are written before the size verdict, including failed measurements.

## Isolated Workshop Worker

The `Workshop` Worker serves only the six read-only workshop capabilities. Cloudflare zone routes claim `ratstack.sh/tokenmaxx/mcp*`, `ratstack.sh/tokenmaxx/rpc*`, `ratstack.sh/tokenmaxx/api/*` and `ratstack.sh/tokenmaxx/openapi.json`; routes take precedence over Mischief's custom domain. It binds public static assets only, with no secrets or production data stores. `apps/infra/alchemy.run.ts` declares it as a new resource beside Mischief. The desk reviews its infrastructure plan before deployment.

Workshop contracts live in `packages/core/src/workshop-contracts.ts`, separate from the main core contract catalog. The startup gate checks every module in Mischief's analysis, including dynamic-only modules, and refuses workshop imports. The prerendered workshop pages stay in the main site's assets. Workshop asset reads validate the generation and cache successful reads only.

Adding workshop links grew the formerly bundled Tokenmaxx Markdown. That source now lives in `/_content/tokenmaxx.json`, read through `ContentStore` before the unchanged fresh-ticket substitution. The browser's prerendered page and interest form stay on the main site. Neither source copy nor exercise copy enters Mischief startup.

Measurements on the same fully built workspace:

| Worker | Main at `ae24f6a` | Shared workshop | Lazy shared workshop | Isolated workshop | Ceiling |
| --- | --: | --: | --: | --: | --: |
| Mischief | 1,113,993 | 1,118,745 | 1,118,313 | 1,100,181 | 1,114,000 |
| LearnFeedbackAuth | 1,515,481 | 1,515,481 | 1,515,481 | 1,515,481 | 1,516,000 |
| Workshop | — | — | — | 862,284 | 870,000 |

Workshop's initial ceiling is its measured static startup rounded up to the next 10,000 bytes. It only shrinks. The other ceilings are unchanged. Early standalone measurements made before all workspace dependencies were built are not valid baselines.

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

## Temporary raise: Alchemy beta.85 and Effect 4.1

The bump to Alchemy `2.0.0-beta.85` and Effect `4.1.2` grew both Workers' static startup sets. Alchemy's `@alchemy.run/cloudflare` `Workers/WorkerBridge.ts` now provides `NodeCrypto.layer`, `NodeChildProcessSpawner`, and `NodeFileSystem` to every Worker. `NodeCrypto.layer` builds all nine `effect/crypto` services, so the AEAD, cipher, signature, key-agreement, and key-wrap modules ship in every Worker. Effect 4.1 also grew `process/CommandLine` and `FileSystem`'s glob support, which those layers reach. Beta.84's bridge used `NodeServices` alone.

| Worker | main `d403594` | bump | bump with lazy MCP | Old ceiling | New ceiling |
| --- | --: | --: | --: | --: | --: |
| Mischief | 1,243,685 | 1,325,739 | 1,113,112 | 1,247,000 | 1,114,000 |
| LearnFeedbackAuth | 1,446,046 | 1,515,492 | 1,515,492 | 1,456,000 | 1,516,000 |

Mischief loads its MCP surface (`src/mcp-surface.ts`, `effect/ai/McpServer`, and the toolkit projections) with a dynamic import on the first `/mcp` request, and the legacy MCP Durable Object loads its runtime the same way. That leaves Mischief below main and lowers its ceiling. LearnFeedbackAuth has no MCP surface, so its ceiling rose by 60,000 bytes. This is the one exception to the shrink-only rule, authorised by the Switchboard ruling of 2026-11-02.

The temporary raise was due to expire on 2026-11-16 or when Alchemy shipped the WorkerBridge fix, whichever came first. Request-time D1 auth first restored the 1,456,000-byte ceiling before that deadline and removed the expiry warning. The follow-up tightened it to 628,000 bytes using the trimmed-size rule below. Upstream issues: [alchemy-run/alchemy#3051](https://github.com/alchemy-run/alchemy/issues/3051) and [#1954](https://github.com/alchemy-run/alchemy/issues/1954).

Startup CPU from `wrangler check startup` 4.94.0, median of three runs per bundle on one host:

| Worker | main elapsed | main non-idle | bump elapsed | bump non-idle | Cloudflare limit |
| --- | --: | --: | --: | --: | --: |
| Mischief | 138.0 ms | 113.9 ms | 130.6 ms | 103.2 ms | 1,000 ms |
| LearnFeedbackAuth | 97.1 ms | 70.6 ms | 107.7 ms | 81.2 ms | 1,000 ms |

### Request-time D1 auth

`packages/auth/src/d1-auth.ts` now loads its implementation with `Effect.promise(() => import("./d1-auth-live.js"))` inside `Layer.unwrap`. Alchemy builds that layer on the first Worker event, not during module evaluation. The layer keeps the same requirements, D1 adapter, options, migration registration, and per-request Better Auth instance. The bridge still owns isolate initialization and memoization; there is no new cache or mutable module state.

Feedback identity now imports its client id and scope from `feedback-constants.ts`, not the plugin implementation. Otherwise that second static edge keeps Better Auth reachable even with the lazy D1 layer. Contracts and schemas remain static. A failed chunk load in `Effect.promise` is a defect that fails Worker initialization. Alchemy beta.85's `Workers/WorkerBridge.ts` resets its cached build promise on failure, so the next event retries initialization. This differs from `Learner.layer`, which maps chunk-load failures to a typed `LearnError`, as described [below](#request-time-learning-and-narrow-imports). A defect is appropriate here because the auth Worker cannot serve any request without its implementation.

Measured after building the full workspace, with the same Alchemy beta.85, Effect 4.1.2, and Better Auth 1.7.11 pins:

| Worker | Before startup bytes | Lazy D1 auth startup bytes | Reduction | Ceiling | Headroom |
| --- | --: | --: | --: | --: | --: |
| LearnFeedbackAuth | 1,515,504 | 618,566 | 896,938 | 628,000 | 9,434 |
| Mischief | 1,096,019 | 1,096,019 | 0 | 1,114,000 | 17,981 |
| Workshop | 731,416 | 731,416 | 0 | 870,000 | 138,584 |
| TurboCache | 475,734 | 475,734 | 0 | 480,000 | 4,266 |

The 628,000-byte ceiling follows the same rule as [Request-time learning and narrow imports](#request-time-learning-and-narrow-imports): trimmed startup size plus 10,000 bytes, rounded down to the nearest 1,000. For 618,566 bytes, that is `floor((618566 + 10000) / 1000) * 1000 = 628000`.

LearnFeedbackAuth's complete JavaScript upload changes from 1,530,341 to 1,532,045 bytes. This change defers evaluation; it does not remove authentication code from the upload. Its entry changes from 123 to 237,343 bytes as Rolldown rearranges shared chunks. The static startup traversal, not the entry size, remains the gate.

Cold profiles from `wrangler check startup` 4.94.0, three runs of each actual multipart auth upload on the same host. From the repository root, after `pnpm --filter @rat-stack/site startup:check`, repeat:

```sh
WRANGLER_SEND_METRICS=false pnpm dlx wrangler@4.94.0 check startup \
  --worker apps/site/dist/startup-auth/worker.bundle \
  --outfile apps/site/dist/startup-auth/worker.cpuprofile
```

| Bundle | Elapsed runs | Median elapsed | Sampled active runs | Median sampled active |
| --- | --- | --: | --- | --: |
| Before | 95.614 / 95.642 / 100.190 ms | 95.642 ms | 67.331 / 64.212 / 66.293 ms | 66.293 ms |
| Lazy D1 auth | 87.583 / 85.416 / 87.382 ms | 87.382 ms | 47.441 / 49.592 / 48.732 ms | 48.732 ms |

Sampled active time sums sample deltas outside V8's `(idle)` and `(program)` frames. These are local cold module-evaluation profiles, not Cloudflare CPU accounting or first-request latency. The first auth request still pays for the deferred implementation.

`test/cold-auth-runtime.test.ts` starts a fresh local workerd Worker with the production lazy Layer and routes (`d1AuthLayer` and `privateFeedbackRoutes`), a real D1 binding, and Better Auth migrations. The fixture provides its services with `Effect.provide` inside init. The production `src/auth/private-worker.ts` instead uses `Layer.build` with `Namespace.set`; the fixture does not reproduce that whole composition. Its first request creates a feedback device, its next request reads the persisted pending device, and an anonymous session request succeeds. Existing HTTP and auth tests cover sign-in, approval, feedback credentials, and writes. A planted runtime-only chunk-load failure makes the first-request test fail with HTTP 500 instead of 200. A planted static implementation import grew startup to 1,515,818 bytes and failed the then-restored 1,456,000-byte ceiling. It also exceeds the follow-up 628,000-byte ceiling. Both mutations were removed.

#### Measurement receipt

The baseline is `b8df5c2`, before lazy D1 auth. The implementation is `edfc165`; the later ceiling-only change is `7192ebf`, with its snapshot at `2b7310c`. The metrics at `2b7310c` reproduce the implementation's startup size. Run these commands in separate clean checkouts of the baseline and `2b7310c`:

```sh
pnpm install --frozen-lockfile
pnpm turbo run build
pnpm --filter @rat-stack/site startup:check
```

Read `apps/site/dist/startup-auth/metrics.json` and `analysis.json`. Count uploaded bytes from only the entry's transitive static imports, once per chunk. The receipt is:

| Metric                           | Before `b8df5c2` | After `2b7310c` |
| -------------------------------- | ---------------: | --------------: |
| Entry bytes                      |              123 |         237,343 |
| Static startup bytes             |        1,515,504 |         618,566 |
| Complete JavaScript upload bytes |        1,530,341 |       1,532,045 |
| Ceiling bytes                    |        1,516,000 |         628,000 |

The following are the static startup chunks for the auth entry. A dash means the chunk is outside that revision's static startup set, not necessarily absent from its upload. Chunk names are bundle outputs, not stable interfaces.

| Chunk | Before bytes | After bytes |
| --- | --: | --: |
| `Redacted-srhks1Eo.js` | 945 | 945 |
| `Stream-C6H6HEox.js` | 136,575 | 136,575 |
| `_distilled_worker-entry__virtual_alchemy-entry_private-worker-tKyHYCZm.js` | 949,137 | — |
| `compiled-query-CvogUxvK.js` | 372 | — |
| `dist-D3M0wlJa.js` | 105,092 | — |
| `factory-Dobc2g-p.js` | 167,956 | — |
| `private-worker.js` | 123 | 237,343 |
| `rolldown-runtime-BJS_XihH.js` | 961 | 961 |
| `sqlite-adapter-Cm6SS7X2.js` | 1,605 | — |
| `sqlite-introspector-DSCAP82F-8db5NyHw.js` | 152,738 | — |
| `vendor-CL8By63l.js` | — | 242,742 |
| **Static startup total** | **1,515,504** | **618,566** |

#### Rerun the planted failures

Use a disposable checkout of `2b7310c`. Keep mutations uncommitted, and undo each experiment's edits before proceeding.

1. **Fail the first runtime chunk load.** In `packages/auth/src/d1-auth.ts`, replace the callback passed to `Effect.promise` with:

   ```ts
   () =>
     globalThis.__ALCHEMY_RUNTIME__
       ? Promise.reject<typeof import("./d1-auth-live.js")>(
           new Error("Planted auth chunk failure")
         )
       : import("./d1-auth-live.js");
   ```

   Run:

   ```sh
   pnpm --filter @rat-stack/auth build
   pnpm --filter @rat-stack/site exec vitest run test/cold-auth-runtime.test.ts
   ```

   Expect the first request assertion to fail: HTTP 500 received instead of 200. The runtime-only condition allows deploy-time initialization and migrations to complete, so this tests the first Worker event rather than a planning failure. Undo the callback replacement.

2. **Make the implementation eager.** Add `import * as eagerAuth from "./d1-auth-live.js";` to `packages/auth/src/d1-auth.ts`. Replace `Effect.promise(() => import("./d1-auth-live.js"))` with `Effect.sync(() => eagerAuth)`, leaving the following `Effect.map` unchanged. Run:

   ```sh
   pnpm --filter @rat-stack/auth build
   pnpm --filter @rat-stack/site startup:check
   ```

   Expect `StartupBudgetExceeded`: LearnFeedbackAuth static startup is 1,515,818 bytes, exceeding the 628,000-byte ceiling. Inspect the failed run's metrics, which are written before the size verdict. Undo the added import and expression replacement.

After removing the mutations, rebuild `@rat-stack/auth`, rerun `test/cold-auth-runtime.test.ts`, and rerun `startup:check` with the commands above. The cold request test and startup gate must pass again.

No WorkerBridge replacement or minification experiment was needed. Beta.85's `getSharedBuild` installs its Node layers unconditionally, with no caller option to omit them. Its Rolldown builder already sets `minify: true`. Both remain unchanged.

## Profile locally

With Wrangler on PATH:

```sh
WRANGLER_SEND_METRICS=false pnpm --filter @rat-stack/site startup:profile
```

Validated with Wrangler 4.94.0. This runs `wrangler check startup --worker` against a multipart bundle assembled from Alchemy's output, not an esbuild substitute. Wrangler imports the bundle in local workerd under the V8 CPU profiler. Open `apps/site/dist/startup/worker.cpuprofile` in Chrome DevTools. The directory also contains JavaScript chunks, source maps, and Rolldown's `analysis.json`.

The harness uses Alchemy's defaults: ESM, minification, preserved names, pure annotations, runtime defines, Cloudflare plugins, and strict execution order. Its production virtual entry exports the `Interest`, `InterestIndex`, and `LegacyMcp` bridges. Placeholder constructor values tell the virtual-entry generator which names are Durable Objects; application constructors remain in `worker.ts`. The stack metadata is `RatStack` / `prod`, with compatibility date `2026-05-28` and `nodejs_compat`.

Keep those names, compatibility settings, and stack metadata aligned with `worker.ts`, the Durable Object declarations, and `apps/infra/alchemy.run.ts`. The internal Alchemy import follows the exact installed pin; review it on an Alchemy bump.

## Size proof and headroom

The pre-extraction entry was **3,090,009 bytes**, with **4,470,503 total JavaScript bytes**. Extraction reduced the entry to **822,362 bytes** and total JavaScript to **2,205,180 bytes**. These historical entry and total figures no longer set hard ceilings.

The Alchemy beta.84 and Effect 4.0.6 bump moved the entry from **853,523** to **949,670 bytes**. Total JavaScript fell from **2,206,460** to **1,295,172 bytes**. The static startup set grew from **1,199,687** to **1,243,260 bytes**, or 3.6%. The Channel, NodeServices and Socket chunks now sit inside the entry. Alchemy's provider packages resolve the `worker` export condition to TypeScript source, and Rolldown splits chunks differently. This layout change exposed the entry-only gate's weakness.

The startup-set gate baseline at `fd7bb92` measures:

- Mischief: **949,849 entry bytes**, **1,243,439 startup bytes**, and **1,295,351 total JavaScript bytes**.
- LearnFeedbackAuth: **123 entry bytes**, **1,588,571 startup bytes**, and **1,603,410 total JavaScript bytes**.

Rounding that baseline up to the next 50,000 bytes gave the original ceilings of 1,250,000 and 1,600,000 bytes. At that baseline, Mischief had **6,561 bytes** of headroom and LearnFeedbackAuth had **11,429 bytes**. A forwarding entry does not hide its statically imported implementation from these ceilings.

### Request-time learning and narrow imports

Against main `fd4ed2a`, with XState still pinned to `6.0.0-alpha.70`:

| Worker | Before startup bytes | After startup bytes | Reduction | Old ceiling | New ceiling | Remaining headroom |
| --- | --: | --: | --: | --: | --: | --: |
| Mischief | 1,248,053 | 1,238,260 | 9,793 | 1,250,000 | 1,247,000 | 8,740 |
| LearnFeedbackAuth | 1,599,083 | 1,446,046 | 153,037 | 1,600,000 | 1,456,000 | 9,954 |

The ceilings were chosen from the initial trimmed startup sizes plus 10,000 bytes, rounded down to the nearest 1,000. Typed feedback chunk failures then added 283 bytes to Mischief and 20 bytes to LearnFeedbackAuth. The ceilings stay unchanged rather than rising to recover that margin. The startup-set calculation is unchanged.

`Learner.layer` supplies the same API without importing its implementation until a method runs. Learner and feedback-machine chunk-load rejections become `LearnError`. The poll contract declares that failure at HTTP 422 alongside its existing HTTP 401 authentication refusal. The public graph reaches `learner-service` and `feedback-machine` only through dynamic imports. Narrow author imports remove both modules entirely from the private auth graph. Narrow cafe and prompt imports also keep the unused file-inspection service and machine out of the public graph.

The request seam test observes native module loading in a fresh Node process running the built app. Requests to `/` and `/news` as HTML and Markdown load no Learner implementation. The first learning request loads it once and succeeds. An eager import planted at layer construction makes that test fail. A separate loader test checks typed chunk-load failure. Existing selection, progress, feedback, HTTP, and published CLI tests cover the unchanged behavior.

Adding 15 synthetic lore pages changed the emitted page count from 111 to 126. Entry size stayed exactly **813,559 bytes**. The generated bootstrap stayed **104,026 bytes**. The temporary pages were removed and the normal generation restored. Subsequent main changes brought the fixed bootstrap to **104,861 bytes**.

Frozen old/new capability comparisons covered **7,698 cases with zero mismatches**, including every original read id and all 7,225 graph path pairs. A permanent fixture preserves representative results for every content capability. Local Worker Loader tests exercise `search → read → backlinks` against the same assets as Node.

## Timing is evidence, not a gate

One pre-extraction local profile measured 157.219 ms elapsed and 111.866 ms sampled non-idle time. Three final post-extraction profiles measured 119.051–195.458 ms elapsed and 79.202–148.417 ms sampled non-idle time. Their medians were 120.926 ms and 80.337 ms.

In initialized local workerd with the asset service primed, cold content-cache requests took 26 ms for search and 12 ms for read. Warm requests took 4 ms each. The readiness probe took 2,207 ms; an earlier unprimed first search took 4,221 ms. These include local development plumbing, not just capability execution.

Main also gained identity validation and observability changes during this slice; this is not an isolated CPU benchmark.

There is deliberately no portable millisecond gate. Wrangler's alpha profiler samples a dynamically imported Worker during a local request. Elapsed time includes inspector and idle time; sampled non-idle time is not Cloudflare's startup CPU accounting. CPUs, runner load, V8 versions, and sampling vary. Use profiles on the same host for comparisons, and calibrate runners against an empty-worker control before making milliseconds a CI threshold.

The startup ceilings guard code growth. Total JavaScript is an alarm only. Neither measurement is Cloudflare's compressed-upload limit or proof that a deployment will start successfully. Live startup and parity remain deployment checks.
