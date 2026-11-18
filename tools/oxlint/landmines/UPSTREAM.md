# Landmines fork

Source: [interfere-inc/landmines](https://github.com/interfere-inc/landmines/tree/2536897dfd8cd57fb33b1eeadbb42b58a7f9de13), commit `2536897dfd8cd57fb33b1eeadbb42b58a7f9de13`. The upstream MIT `LICENSE` is copied verbatim. There is no package dependency.

## Copied and adapted

Source paths below are relative to `packages/landmines/src/` upstream.

| Upstream path | Local path | Local changes |
| --- | --- | --- |
| `rules/no-fixed-sleep.ts` | `rules/no-fixed-sleep.ts` | Keep awaited promise timers, timer imports, Bun and scheduler sleeps, and the run-now callbacks. Resolve runner and timer imports. Require a preceding unconditional, unconfigured `vi.useFakeTimers()` in the same callback block for the promise-timer exemption; a later clock change cancels it. Add imported `Effect.sleep` calls, including inside pipes and `Effect.gen`, on `it.live` and `test.provider` from Alchemy's Vitest harness, not `it.effect`. |
| `rules/no-unsignaled-poll.ts` | `rules/no-unsignaled-poll.ts` | Keep imported `expect.poll` and `vi.waitFor` with recognized spy matchers and `.mock` call/result fields. Narrow generic `.length`, `.size`, and `toHaveLength` checks to named recorder reads. Add `recorderNames` for a child repo's explicit recorder list. |
| `rules/no-flake-masking.ts` | `rules/no-flake-masking.ts` | Resolve aliased and namespace runner imports, Alchemy `Test.make` bindings, and Effect layer callback testers. Match Vitest config only through `vitest/config` or `vi.setConfig`. Allow literal `retry: 0` and simple local const zero; reject imported Effect `flakyTest`. Track reviewable per-test budgets and config `testTimeout`/`hookTimeout`. The generated inputs to `.prop` are not options; its fourth argument can be. Normalize numeric literals and simple local const initializers. |
| `rules/no-{fixed-sleep,unsignaled-poll,flake-masking}.test.ts` | `rules.test.ts` | Port applicable positive and negative cases to Oxlint's `RuleTester`. Supply real import provenance in fixtures. Remove upstream allowlist cases and add clock, provider, import, retry and timeout cases. |

All three rules use Effect Schema for options instead of Zod. Diagnostic text uses rat-stack's fence grammar. `index.ts` registers only the three ported implementations. Oxlint assigns severity per rule ID, so `no-flake-masking-timeout` uses the same implementation with the timeout option while `no-flake-masking` checks retries. The upstream testing entry point and its count/suffix allowlist are not copied. `syntax.ts`, `finding.ts`, and `baseline.ts` are local helpers. The real-config fixture in `packages/core/test/landmines.test.ts` checks severities and the rendered messages.

## Budget baseline

`baseline.json` is the tracked allowance. Its exact repo-relative paths map to arrays of findings. The length of each array is the file's count. Each budget lists the kind, enclosing suite/test or config owner, option, and value. Each entry has one line that says what the budget waits for. The initial scan recorded 47 test overrides, 31 config defaults and one real sleep that staggers workerd expiry deadlines. Six candidate hits from `it.effect.prop` with an arbitrary-only options object were removed in the matcher, not in the baseline. Retries and unsignaled polls had no findings and start at error.

`pnpm check:landmines` compares exact paths and budgets with current Oxlint warnings. Remove stale entries when a finding or file disappears. Supply a reason for any new or changed finding. PR CI supplies the base commit in `LANDMINES_BASE` and rejects reusing a reason from the same file for a new budget. A person still checks whether the reason justifies the budget. Counts alone do not authorize a swap or a raised value.

The checker detects literal changes, including changes to a numeric local `const` used directly as a budget. It compares other expressions as tokens. It does not evaluate imports, runtime config, transitive constants, or values hidden behind spreads. Signatures with identical paths, owners, option names and values are counted, not individually distinguished. The rules check syntax, not what runs under every possible timer configuration or callback wrapper.

`eventually` in `apps/site/test/fixtures/flag-ledger-client.ts` polls observable state in real workerd and stops at a deadline. It is not a poll of an in-process spy or request recorder.

## Update

1. Check out the proposed upstream commit outside the repo. Diff its three rules, their tests, and the MIT license against the pin above.
2. Port selected changes without importing upstream's entry point, dependency graph, or allowlist. Record what you took and what you rejected here. Keep the provenance line and pin in sync.
3. Run `pnpm --filter @rat-stack/core exec vitest run test/landmines.test.ts` and `pnpm check:landmines`. Plant one violation for each new matcher and see its fixture fail with the matcher disabled.
4. Explain each added budget; remove each stale entry. Run `pnpm turbo run check test build --summarize`.
