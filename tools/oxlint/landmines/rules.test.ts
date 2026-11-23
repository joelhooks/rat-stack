import { RuleTester } from "oxlint/plugins-dev";

import { noFixedSleep } from "./rules/no-fixed-sleep.ts";
import { noFlakeMasking } from "./rules/no-flake-masking.ts";
import { noTestDoubles } from "./rules/no-test-doubles.ts";
import { noUnsignaledPoll } from "./rules/no-unsignaled-poll.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const js = 'import { test, it, beforeEach, afterEach, vi } from "vitest";';
const fx =
  'import { it, flakyTest } from "@effect/vitest"; import { Effect } from "effect";';
const provider =
  'import * as Test from "@alchemy.run/test/Vitest"; import { Effect } from "effect"; const { test: run } = Test.make({});';
const poll = 'import { expect, vi } from "vitest";';
const config = 'import { defineConfig as config } from "vitest/config";';
const clock = "await new Promise((done) => setTimeout(done, 50));";

const reported = (code: string, messageId: string) => ({
  code,
  errors: [{ messageId }],
});

tester.run("landmines/no-fixed-sleep", noFixedSleep, {
  valid: [
    `${js} test('x', async () => { await operation(); });`,
    `${js} test('x', async () => { const ready = Promise.withResolvers(); await ready.promise; });`,
    `${js} test('x', async () => { vi.useFakeTimers(); ${clock} });`,
    `${js} serve(async () => { await scheduler.wait(10); });`,
    `${js} async function backoff(attempt) { await scheduler.wait(2 ** attempt); } test('x', async () => { await backoff(1); });`,
    `${js} test('x', async () => { await Promise.race([work, new Promise((resolve) => setTimeout(() => resolve('pending'), 0))]); });`,
    `${js} test('x', async () => { await new Promise((resolve) => { setTimeout(resolve, 10); queueMicrotask(resolve); }); });`,
    `${js} test('x', async () => { await new Promise((resolve) => emitter.once('done', resolve)); });`,
    `${js} import { setImmediate } from 'node:timers/promises'; test('x', async () => { await setImmediate(); });`,
    `${js} test('x', async () => { const timer = setTimeout(cancel, 10); await work(); clearTimeout(timer); });`,
    `${js} test('x', async ({ page }) => { await page.route(url, async () => { await scheduler.wait(5); }); });`,
    `${js} test('x', async () => { await act(async () => { serve(async () => { await scheduler.wait(10); }); }); });`,
    `${fx} it.effect('virtual', () => Effect.gen(function* () { yield* Effect.sleep('1 second'); }));`,
    `${fx} it.effect('virtual pipe', () => Effect.sleep('1 second').pipe(Effect.asVoid));`,
    `import { it } from '@effect/vitest'; const Effect = { sleep: () => 1 }; it.live('unrelated', () => Effect.sleep(1));`,
    {
      code: `${js} test('x', async () => { await act(async () => { await scheduler.wait(1); }); });`,
      options: [{ runNow: ["within"] }],
    },
  ],
  invalid: [
    ...[
      `${js} test('x', async () => { ${clock} });`,
      `${js} test('x', async () => { await new Promise<void>((done) => globalThis.setTimeout(() => { done(); }, 31_000)); });`,
      `${js} it('x', async () => { await new Promise((done) => window.setTimeout(done, 600)); });`,
      `${js} import { setTimeout as sleep } from 'node:timers/promises'; test('x', async () => { await sleep(500); });`,
      `${js} import { setTimeout } from 'timers/promises'; afterEach(async () => { await setTimeout(20); });`,
      `${js} beforeEach(async () => { await scheduler.wait(10); });`,
      `${js} test('x', async () => { await Bun.sleep(100); });`,
      `${js} test.each([1])('x %s', async () => { await scheduler.wait(1); });`,
      `${js} it.skipIf(ci)('x', async function () { await scheduler.wait(1); });`,
      `${js} it('x', async () => { await React.act(async () => { await act(async () => { await scheduler.wait(1); }); }); });`,
      `${js} test('x', async () => { await waitFor(async () => { await scheduler.wait(1); expect(ready).toBe(true); }); });`,
      `${js} test('x', async () => { await load().then(async () => { await Bun.sleep(5); }); });`,
      `${js} beforeEach(() => load().catch(async () => { await scheduler.wait(1); }));`,
      `${js} afterEach(() => load().finally(async () => { await scheduler.wait(1); }));`,
      `${js} test('x', async () => { await test.step('open', async () => { await scheduler.wait(1); }); });`,
      `${js} test('fake', async () => { vi.useFakeTimers(); ${clock} }); test('live', async () => { ${clock} });`,
      `${js} test('reset', async () => { vi.useFakeTimers(); vi.useRealTimers(); ${clock} });`,
      `${js} test('conditional', async () => { if (flag) vi.useFakeTimers(); ${clock} });`,
      `${js} test('too late', async () => { ${clock} vi.useFakeTimers(); });`,
      `${js} test('only dates', async () => { vi.useFakeTimers({ toFake: ['Date'] }); ${clock} });`,
      `${js} test('shadowed', async (vi) => { vi.useFakeTimers(); ${clock} });`,
      `${fx} it.live('direct', () => Effect.gen(function* () { yield* Effect.sleep('1 second'); }));`,
      `${fx} it.live('piped', () => Effect.succeed(1).pipe(Effect.andThen(Effect.sleep('1 second'))));`,
      `import { it as spec } from '@effect/vitest'; import { sleep as wait } from 'effect/Effect'; spec.live('aliased', () => wait(1));`,
      `${provider} run.provider('real', () => Effect.gen(function* () { yield* Effect.sleep(100); }));`,
    ].map((code) => reported(code, "sleep")),
    {
      ...reported(
        `${js} test('x', async () => { await within(async () => { await scheduler.wait(1); }); });`,
        "sleep"
      ),
      options: [{ runNow: ["within"] }],
    },
  ],
});

tester.run("landmines/no-unsignaled-poll", noUnsignaledPoll, {
  valid: [
    "const request = Promise.withResolvers(); await request.promise;",
    `${poll} await expect.poll(() => result.current.items.length).toBe(2);`,
    `${poll} await expect.poll(() => result.current.save).toHaveBeenCalled();`,
    `${poll} await expect.poll(() => curves('overlaid-area').length).toBe(3);`,
    `${poll} await expect.poll(() => rows.elements().length).toBe(6);`,
    `${poll} await expect.poll(() => document.title).toBe('Slack');`,
    `${poll} await expect.poll(() => status).toStrictEqual({ ready: true });`,
    `${poll} await expect.poll(() => network.snapshot().pending.length).toBe(1);`,
    `${poll} await vi.waitFor(() => expect(screen.getByText('Saved')).toBeVisible());`,
    `${poll} await vi.waitFor(() => expect(status).toBe('ready'));`,
    `${poll} expect(requests).toHaveLength(1); expect(onComplete).toHaveBeenCalledOnce();`,
    `${poll} await expect.poll(() => server.peers.size).toBe(1);`,
    `${poll} await expect.poll(() => pending).toHaveLength(1);`,
    `${poll} await eventually(Effect.all([row.rows, row.alarmPending]), ([rows, pending]) => rows === 0 && !pending);`,
    `${poll} function x(expect) { return expect.poll(() => requests.length).toBe(1); }`,
  ],
  invalid: [
    ...[
      "await expect.poll(() => requests.length, { timeout: 5000 }).toBe(3);",
      "await expect.poll(() => traffic.requests.length).toBe(1);",
      "await expect.poll(() => requestedChunks.size).toBeGreaterThan(0);",
      "await expect.poll(() => { return recordedCalls.length; }).toBe(2);",
      "await expect.poll(() => onComplete.mock.calls.length).toBe(1);",
      "await expect.poll(() => reload.mock.settledResults[0]?.type).toBe('rejected');",
      "await expect.poll(() => spy).toHaveBeenCalledTimes(1);",
      "await expect.poll(() => spy).not.toHaveReturned();",
      "await vi.waitFor(() => expect(preload).toHaveBeenCalledTimes(2));",
      "await vi.waitFor(() => expect(state.post).toHaveBeenCalledOnce());",
      "await vi.waitFor(() => expect(cancel).not.toHaveBeenCalledWith(1));",
      "await vi.waitFor(() => expect(requests).toHaveLength(1));",
      "await vi.waitFor(() => expect(cancel.mock.calls.length).toBeGreaterThan(0));",
      "await vi.waitFor(() => { expect(fetcher).toHaveBeenCalled(); });",
    ].map((code) => reported(`${poll} ${code}`, "poll")),
    {
      ...reported(
        `${poll} await expect.poll(() => traffic.uploads).toHaveLength(2);`,
        "poll"
      ),
      options: [{ recorderNames: ["uploads"] }],
    },
  ],
});

tester.run("landmines/no-flake-masking retries", noFlakeMasking, {
  valid: [
    `${js} test('x', async () => {});`,
    `${js} test('x', { retry: 0 }, async () => {});`,
    `${js} const retry = 0; test('x', async () => {}, { retry });`,
    `${js} vi.setConfig({ retry: 0 });`,
    `${config} export default config({ test: { retry: 0 } });`,
    `${fx} it.prop('x', { retry: Schema.Int }, () => {});`,
    `${fx} it.effect.prop('x', { retry: Schema.Int }, () => Effect.void, { retry: 0 });`,
    `${fx} function x(flakyTest) { flakyTest(Effect.void); }`,
    `import { defineConfig } from 'vite'; export default defineConfig({ test: { retry: 3 } });`,
    `${js} function method(test) { test('x', { retry: 2 }, () => {}); }`,
    `${js} queue.retry({ delaySeconds: 30 }); const policy = { retry: { maxAttempts: 1 } };`,
  ],
  invalid: [
    ...[
      `${js} test('x', { retry: 2 }, async () => {});`,
      `${js} test.concurrent('x', async () => {}, { retry: 1 });`,
      `${js} test.each([1, 2])('x %i', { retry: 1 }, async () => {});`,
      `${js} it('x', { retry: 1 }, callback);`,
      `${js} vi.setConfig({ retry: 2 });`,
      `${fx} flakyTest(Effect.void);`,
      `import { flakyTest as retryTest } from '@effect/vitest'; retryTest(work);`,
      `${fx} it.layer(service)((test) => { test.flakyTest(Effect.void); });`,
      `${config} export default config({ test: { retry: process.env.CI ? 2 : 0 } });`,
      `${config} export default config({ test: { projects: [{ test: { name: 'node', retry: 1 } }] } });`,
    ].map((code) => reported(code, "retry")),
  ],
});

const timeout = (code: string) => ({
  code,
  options: [{ check: "timeout" }],
  errors: [{ messageId: "timeout" }],
});

tester.run("landmines/no-flake-masking timeouts", noFlakeMasking, {
  valid: [
    `${js} it('x', async () => {});`,
    `${js} test('x', { tags: ['slow'] }, async () => {});`,
    `${js} beforeEach(async () => {}, 60_000);`,
    `${js} await vi.waitFor(() => expect(count()).toBe(1), { timeout: 5000 });`,
    `${config} const unrelated = { test: { testTimeout: 60_000, hookTimeout: 50_000 } }; export default config({});`,
    `import { defineConfig } from 'vite'; export default defineConfig({ test: { hookTimeout: 60_000 } });`,
    `${config} function x(config) { config({ test: { hookTimeout: 60_000 } }); }`,
    `${fx} it.prop('x', { timeout: Schema.Int }, () => {});`,
    `${fx} const options = { arbitrary: { runs: 40 } }; it.effect.prop('x', { timeout: Schema.Int }, () => Effect.void, options);`,
    `${fx} it.layer(service, { timeout: 60_000 })((test) => { test.effect('x', () => Effect.void); });`,
  ].map((code) => ({ code, options: [{ check: "timeout" }] })),
  invalid: [
    ...[
      `${js} test('x', async () => {}, 60_000);`,
      `${js} const TIMEOUT = 30_000; it('x', async () => {}, TIMEOUT);`,
      `${js} test('x', async () => {}, 2 * 60_000);`,
      `${js} test('x', { timeout: 60_000 }, async () => {});`,
      `${js} test('x', async () => {}, { timeout: 60_000 });`,
      `${js} test.each([1])('x %i', async () => {}, 20_000);`,
      `${js} test.skipIf(ci)('x', async () => {}, 20_000);`,
      `${js} vi.setConfig({ hookTimeout: 45_000 });`,
      `${config} export default config({ test: { hookTimeout: 60_000 } });`,
      `${config} export default config(() => ({ test: { testTimeout: 60_000 } }));`,
      `${config} export default config({ test: { projects: [{ test: { name: 'e2e', testTimeout: 60_000 } }] } });`,
      `${fx} it.effect.prop('x', { timeout: Schema.Int }, () => Effect.void, { timeout: 60_000 });`,
      `${fx} it.layer(service)('layer', (test) => { test.effect('x', () => Effect.void, 60_000); });`,
      `${provider} run.provider('x', () => Effect.void, { timeout: 60_000 });`,
    ].map(timeout),
    {
      code: `${config} export default config({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });`,
      options: [{ check: "timeout" }],
      errors: [{ messageId: "timeout" }, { messageId: "timeout" }],
    },
  ],
});

const layer = 'import { Effect, Layer } from "effect";';
const doubled = (code: string) => reported(code, "double");

tester.run("landmines/no-test-doubles", noTestDoubles, {
  valid: [
    `${js} test('x', () => { const onSave = vi.fn(); save(onSave); expect(onSave).toHaveBeenCalledOnce(); });`,
    `${js} test('x', () => { const onSave = vi.fn(undefined); save(onSave); });`,
    `${js} test('x', () => { const log = vi.spyOn(console, 'log'); run(); expect(log).toHaveBeenCalled(); });`,
    `${js} ${layer} const store = Layer.succeed(Store, memoryStore);`,
    `${js} ${layer} const gate = Layer.succeed(Gate, { allow: () => Effect.succeed(true) });`,
    `${js} ${layer} const sink = Layer.succeed(Sink, { send: () => Effect.fail(new SinkDown()) });`,
    `${js} import * as Layer from "effect/Layer"; const store = Layer.succeed(Store, memoryStore);`,
    `${js} test('x', () => { globalThis.__ALCHEMY_RUNTIME__ = true; });`,
    `${js} test('x', () => { let fetch = real; fetch = other; });`,
    `${js} test('x', (globalThis) => { globalThis.fetch = canned; });`,
    `${js} test('x', () => { Object.defineProperty(request, 'cf', { value: edge }); });`,
    `${js} test('x', () => { Object.assign(globalThis, { __probe: bindings }); });`,
    `${js} test('x', () => { const vi = { fn: (f) => f }; vi.fn(() => 1); });`,
    `import { vi } from "./clock.ts"; vi.fn(() => 1); vi.stubGlobal('fetch', canned);`,
    {
      code: "globalThis.fetch = instrumentedFetch;",
      filename: "apps/site/src/asset-deployment.ts",
    },
    'import { mock } from "./fixtures.ts"; mock(Store, {});',
  ],
  invalid: [
    ...[
      `${js} test('x', () => { const save = vi.fn(() => 'saved'); });`,
      `${js} test('x', () => { const save = vi.fn(async () => ({ ok: true })); });`,
      `import { vi as v } from "@effect/vitest"; v.fn(handler);`,
      `import * as V from "vitest"; V.vi.fn(handler);`,
      `${js} test('x', () => { vi.spyOn(api, 'load').mockResolvedValue([]); });`,
      `${js} test('x', () => { save.mockImplementation(() => 1); });`,
      `${js} test('x', () => { save.mockReturnValueOnce(2); });`,
      `${js} test('x', () => { save.withImplementation(() => 1, run); });`,
      `${js} beforeEach(() => { vi.stubGlobal('fetch', canned); });`,
      `${js} test('x', () => { vi.mockObject(api); });`,
      `${js} test('x', async () => { await vi.importMock('./api.ts'); });`,
      `${layer} const users = Layer.mock(UserService, { getUser: () => Effect.succeed(user) });`,
      `${layer} const users = Layer.mock(UserService)({ getUser: () => Effect.succeed(user) });`,
      `import * as Layer from "effect/Layer"; Layer.mock(UserService, {});`,
      `import { mock } from "effect/Layer"; mock(UserService, {});`,
      `${js} test('x', () => { globalThis.fetch = () => Promise.resolve(new Response('ok')); });`,
      `${js} test('x', () => { window.matchMedia = () => query; });`,
      `${js} test('x', () => { fetch = canned; });`,
      `${js} test('x', () => { Date.now = () => 0; });`,
      `${js} test('x', () => { Math.random = () => 0.5; });`,
      `${js} test('x', () => { globalThis.crypto.randomUUID = () => 'id'; });`,
      `${js} test('x', () => { navigator.clipboard.writeText = write; });`,
      `${js} test('x', () => { localStorage.getItem = () => null; });`,
      `${js} test('x', () => { HTMLElement.prototype.scrollIntoView = () => {}; });`,
      `${js} test('x', () => { Object.defineProperty(globalThis, 'fetch', { value: canned }); });`,
      `${js} test('x', () => { Reflect.set(navigator, 'onLine', false); });`,
      `${js} test('x', () => { Object.defineProperties(document, { hidden: { value: true } }); });`,
      `${js} test('x', () => { Object.assign(globalThis, { fetch: canned }); });`,
      `${js} test('x', () => { delete globalThis.navigator; });`,
    ].map(doubled),
    {
      code: "globalThis.fetch = canned;",
      filename: "packages/core/test/fixtures/network.ts",
      errors: [{ messageId: "double" }],
    },
  ],
});
