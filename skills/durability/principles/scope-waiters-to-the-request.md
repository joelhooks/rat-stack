# Scope waiters to the request

**Applies when:** sharing an in-flight result, a permit, or a signal between callers.

Construct every waiting primitive inside the Effect or Layer body that owns it, or inside a Durable Object instance. Never store one in a module `const`, a static field, or the result of an `Effect.run*` call at module level.

**Why:** A Worker isolate serves many requests. A module-level waiter is shared by all of them. One request then waits on another request's pending work, which may belong to a cancelled context. The caller hangs or gets a 503.

**Effect primitive:** `Layer.effect(Tag, Ref.make(...))`, not `Layer.succeed(Tag, Ref.makeUnsafe(...))`. The same holds for `Deferred`, `Cache`, `Semaphore`, `Queue`, `Latch`, `PubSub`, `PartitionedSemaphore`, and `TxSemaphore`.

**Example:** `packages/database/src/connection-lease.ts` builds its `RcRef` per execution scope under a `Semaphore` that the lease creates. `apps/site/src/interest/interest-durable-object.ts` keeps storage per Durable Object instance.

**Incident:** drovr, 2026-10-23 (cars #2344 and #2348). Cross-request waiters in a Worker isolate made another caller hang or receive a 503.

**Held by:** `rat-stack-patterns/shared-waiters` in `scripts/oxlint-plugin-patterns.ts`. `packages/core/test/patterns-rule.test.ts` has one rejecting and one allowed fixture per constructor, for every family checked against the Effect 4.0.0 declarations. Each new family's fixture failed before its map entry existed. PubSub's `makeAtomicBounded` and `makeAtomicUnbounded` stay out of the rule: they return a buffer with no waiters.

**Read more:** Switchboard's recs-v0 durability review. drovr-mode A7 and A8.
