# Events cartridge

`@rat-stack/events` records one `request` event for each HTTP request. It owns request capture and its privacy rules: visitor ids, the visitor salt, the `daily` and `persistent` identity modes, query redaction, and geography limits.

The rest of the repo sees only ports in `@rat-stack/core`:

- `EventSink` in `@rat-stack/core/event-sink` takes `RawEvent` values. Its default drops them, so a composition without a sink still serves.
- `eventsOff` and `memoryEventsOff` in `@rat-stack/core/request-capture` compose no capture.
- `RawEventSchema` and `IdentityModeSchema` are the wire contract.

`apps/site/src/events.ts` is the only file outside this package that imports it. The `rat-stack-boundaries/no-cross-layer-imports` rule enforces that.

```ts
export { events, memoryEvents } from "@rat-stack/events/site";
```

- `events({ enabled, id })` declares the Basin resources. When `enabled` is true, it also returns the capture function. When `enabled` is false, it returns `undefined` and the Worker serves with capture off.
- `memoryEvents(salt)` returns the same capture function over an in-memory sink, plus `recorded`, for privacy tests.

## Remove the cartridge

1. Replace the line in `apps/site/src/events.ts` with:

   ```ts
   export {
     eventsOff as events,
     memoryEventsOff as memoryEvents,
   } from "@rat-stack/core/request-capture";
   ```

2. Delete `packages/events`.
3. Delete the `@rat-stack/events` line in `apps/site/package.json`.
4. Run `pnpm install`, then `pnpm turbo run check test build`.

The Worker builds and serves with capture off. Tests that read `memoryEvents` still run. They assert that telemetry never holds private values, which holds with nothing recorded. The Basin resources leave the Stack, and the retained R2 bucket, stream, and salt stay in the cloud account until someone deletes them.

## Check

Run `pnpm --filter @rat-stack/events test`. The tests are property and model based. `apps/site/test/worker-events.test.ts` proves the Worker wires any capture function with live settings and runs its background work through `waitUntil`.
