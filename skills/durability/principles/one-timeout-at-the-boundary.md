# Set a provider timeout once, at its boundary

**Applies when:** waiting on a provider, or adding a second call path to a provider that already has a timeout.

Give each provider one timeout value. Declare it as a `Context.Reference` with the default beside the adapter. Every call path to that provider reads the same reference. The composition root sets it from Config, so a change needs no code edit.

**Why:** Timeout literals copied into several layers drift apart. The shortest one wins without anyone choosing it, and a tuning change misses a copy.

**Effect primitive:** `Context.Reference` for the value and its default, read once when the layer is built. `Effect.timeoutOption` or `Effect.timeoutOrElse` at the one call site, with a typed outcome for the timeout.

**Example:** `DrovrIntakeTimeout` in `packages/subscriber-delivery/src/drovr-intake.ts` defaults to 20 seconds. The browser intake and `drovr-agent-intake.ts` both read it. `apps/site/src/worker.ts` reads `DROVR_INTAKE_TIMEOUT_SECONDS` (1 to 60) and passes it through `subscriberDeliveryLayer`. A timeout still returns a same-submission retry. It interrupts our fiber, not drovr, so the request may still land.

**Incident:** drovr, 2026-10-23 (drovr-mode A8 and O7). Joel asked for a 30 s PostShiba timeout, and #2339 changed a constant by deploy. In rat-stack, two drovr intake layers each held their own `"20 seconds"` literal.

**Held by:** `packages/subscriber-delivery/test/intake-timeout.test.ts`. The property generates a configured timeout and a drovr latency and checks that both intake paths give up at the same instant. Put a literal back in either layer and it fails.
