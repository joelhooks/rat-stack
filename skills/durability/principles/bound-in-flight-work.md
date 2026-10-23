# Bound work in flight, and move the cursor past acknowledged items only

**Status:** placeholder. drovr writes the rule, the why, and the incident. The desk filled in the example and the fence.

**Applies when:** reading or sending many items through one provider or store.

**Effect primitive:** `Effect.forEach(items, f, { concurrency: n })`, or `Semaphore.withPermits`.

**Example:** `apps/site/src/interest/applications.ts` reads applications with `{ concurrency: applicationReadConcurrency }` (8) and returns them in id order. `intakeRedeliver` stops at the first outcome other than accepted. It returns the rest as `notAttempted`, so a caller resumes past acknowledged items only.

**Held by:** `apps/site/test/intake-applications-concurrency.test.ts`. The bound property fails on `concurrency: "unbounded"`. `packages/core/test/intake-redeliver.test.ts` covers the stopping cursor.
