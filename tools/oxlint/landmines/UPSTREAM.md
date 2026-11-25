# Landmines fork

Source: [interfere-inc/landmines](https://github.com/interfere-inc/landmines/tree/2536897dfd8cd57fb33b1eeadbb42b58a7f9de13), commit `2536897dfd8cd57fb33b1eeadbb42b58a7f9de13`. The upstream MIT `LICENSE` is copied verbatim. There is no package dependency.

## Copied and adapted

Source paths below are relative to `packages/landmines/src/` upstream.

| Upstream path | Local path | Local changes |
| --- | --- | --- |
| `rules/no-fixed-sleep.ts` | `rules/no-fixed-sleep.ts` | Keep awaited promise timers, timer imports, Bun and scheduler sleeps, and the run-now callbacks. Resolve runner and timer imports. Require a preceding unconditional, unconfigured `vi.useFakeTimers()` in the same callback block for the promise-timer exemption; a later clock change cancels it. Add imported `Effect.sleep` calls, including inside pipes and `Effect.gen`, on `it.live` and `test.provider` from Alchemy's Vitest harness, not `it.effect`. |
| `rules/no-unsignaled-poll.ts` | `rules/no-unsignaled-poll.ts` | Keep imported `expect.poll` and `vi.waitFor` with recognized spy matchers and `.mock` call/result fields. Narrow generic `.length`, `.size`, and `toHaveLength` checks to named recorder reads. Add `recorderNames` for a child repo's explicit recorder list. |
| `rules/no-flake-masking.ts` | `rules/no-flake-masking.ts` | Resolve aliased and namespace runner imports, Alchemy `Test.make` bindings, and Effect layer callback testers. Match Vitest config only through `vitest/config` or `vi.setConfig`. Allow literal `retry: 0` and simple local const zero; reject imported Effect `flakyTest`. Track reviewable per-test budgets and config `testTimeout`/`hookTimeout`. The generated inputs to `.prop` are not options; its fourth argument can be. Normalize numeric literals and simple local const initializers. |
| `rules/no-test-doubles.ts` | `rules/no-test-doubles.ts` | Rewritten on `syntax.ts`, about a sixth of upstream's size. Keep implemented `vi.fn`, the `mock*` and `withImplementation` replacement methods, `vi.stubGlobal`, `vi.mockObject` and `vi.importMock` resolved through `vitest` or `@effect/vitest` imports. Keep upstream's global, `document`, `navigator`, storage and nested tables for assignment, `delete`, `Object.defineProperty(ies)`, `Object.assign`, `Reflect.set` and `Reflect.defineProperty`, in test code only. Widen prototypes to any `X.prototype.y` write. Add Effect `Layer.mock`. Report a `double` budget. |
| `rules/no-{fixed-sleep,unsignaled-poll,flake-masking}.test.ts` | `rules.test.ts` | Port applicable positive and negative cases to Oxlint's `RuleTester`. Supply real import provenance in fixtures. Remove upstream allowlist cases and add clock, provider, import, retry and timeout cases. |

The option-bearing rules use Effect Schema for options instead of Zod. Diagnostic text uses rat-stack's fence grammar. `index.ts` registers only the four ported implementations. Oxlint assigns severity per rule ID, so `no-flake-masking-timeout` uses the same implementation with the timeout option while `no-flake-masking` checks retries. The upstream testing entry point and its count/suffix allowlist are not copied. `syntax.ts`, `finding.ts`, and `baseline.ts` are local helpers. The real-config fixture in `packages/core/test/landmines.test.ts` checks severities and the rendered messages.

## Test doubles and Effect layers

`no-test-doubles` separates three Effect shapes by what the syntax shows.

1. A real alternate implementation of a port, such as `EventSinkMemory` or the catalog memory store, is allowed. `Layer.succeed`, `Layer.effect` and `Layer.sync` are never reported. Effect's own testing guide builds `TodoRepo.layerTest` from a `Ref`-backed implementation (`ai-docs/src/09_testing/20_layer-tests.ts` in the pinned mirror).
2. A per-test canned stub passed inline to `Layer.succeed` is not reported. This is a known gap, not an endorsement. The 2026-11-23 scan found 157 `Layer.succeed` or `Layer.sync` calls in test code. 28 have an inline member that ignores its arguments and closure, but they are an unused half of a port (`record: () => Effect.void`), a die-sentinel, or fault injection (`EventSink.send` failing). Whether a member stands in for the behaviour under test depends on the subject under test, which the syntax does not show.
3. `Layer.mock` is always reported. In Effect `4.1.4`, `Layer.ts` documents it as "a mock layer for testing purposes" built from "a partial implementation" (`@category testing`). `mockImpl` is `succeed(service)` over a Proxy whose missing effectful members die with `UnimplementedError`. Its `PartialEffectful` type lets a caller omit members, so it can never be a complete alternate implementation.

Network transports are allowed. An `HttpClient.make` layer or a `FetchHttpClient.Fetch` service runs the real client encode and decode path and replaces only the wire, as MSW does upstream. Effect's GraphQL testing guide uses handler-scripted clients the same way (`ai-docs/src/52_graphql/20_testing.ts`).

Not copied: module mocks (`vi.mock`, `vi.doMock` and `vi.unstable_mockModule` belong to `anti-slop/no-module-mocking`), Jest globals and `jest.*` APIs, Tauri IPC mocks, Playwright `route.fulfill`, Knock and native-`fetch`-typed bindings that return raw `Response` objects, Hono `app.request` environments, `cloudflare:test` Worker binding edits, Miniflare `outboundService` and `serviceBindings` config, the save, replace and restore monkeypatch check, and the destructured `const { fn } = vi` and aliased-global (`const g = globalThis`) paths. Rat-stack has no Jest, Tauri, Playwright, Knock, Hono, MSW or `cloudflare:test` imports, and Worker runtime tests run through Alchemy's harness. Handwritten Worker bindings therefore have no import to anchor on and stay a gap.

## Budget baseline

`baseline.json` is the tracked allowance. Its exact repo-relative paths map to arrays of findings. The length of each array is the file's count. Each budget lists the kind, enclosing suite/test or config owner, option, and value. Each entry has one line that says what the budget waits for. The initial scan recorded 47 test overrides, 31 config defaults and one real sleep that staggers workerd expiry deadlines. Six candidate hits from `it.effect.prop` with an arbitrary-only options object were removed in the matcher, not in the baseline. Retries and unsignaled polls started at error with no findings. They now warn and are not included in the budget check. `no-test-doubles` landed at warn with a `double` budget kind (owner, API, target) and no findings, so it adds no baseline entries. `budgetRuleIds` in `baseline.ts` lists the rules `pnpm check:landmines` enforces.

`pnpm check:landmines` compares exact paths and budgets with current Oxlint warnings. Remove stale entries when a finding or file disappears. Supply a reason for any new or changed finding. PR CI supplies the base commit in `LANDMINES_BASE` and rejects reusing a reason from the same file for a new budget. A person still checks whether the reason justifies the budget. Counts alone do not authorize a swap or a raised value.

The checker detects literal changes, including changes to a numeric local `const` used directly as a budget. It compares other expressions as tokens. It does not evaluate imports, runtime config, transitive constants, or values hidden behind spreads. Signatures with identical paths, owners, option names and values are counted, not individually distinguished. The rules check syntax, not what runs under every possible timer configuration or callback wrapper.

`eventually` in `apps/site/test/fixtures/flag-ledger-client.ts` polls observable state in real workerd and stops at a deadline. It is not a poll of an in-process spy or request recorder.

## Update

1. Check out the proposed upstream commit outside the repo. Diff its four rules, their tests, and the MIT license against the pin above.
2. Port selected changes without importing upstream's entry point, dependency graph, or allowlist. Record what you took and what you rejected here. Keep the provenance line and pin in sync.
3. Run `pnpm --filter @rat-stack/core exec vitest run test/landmines.test.ts` and `pnpm check:landmines`. Plant one violation for each new matcher and see its fixture fail with the matcher disabled.
4. Explain each added budget; remove each stale entry. Run `pnpm turbo run check test build --summarize`.
