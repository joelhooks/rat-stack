# Answer at commit, dispatch off the request

**Applies when:** a Durable Object accepts work that needs an external provider.

Commit the fold and its pending-dispatch marker before answering the caller. The Durable Object owns the durable state; provider responses are acknowledgements, not the system of record. Schedule the first provider attempt with `ctx.waitUntil` under the accepted operation's idempotency key. Keep a durable marker and an alarm lease as the recovery path. A background promise alone does not make accepted work durable.

**Why:** Waiting for the provider makes request latency depend on delivery latency. A lost response can make the caller retry work that already committed.

**Effect primitive:** Describe dispatch as a named `Effect.fn` and run it at the platform boundary for `ctx.waitUntil`. Keep retries and cancellation in an XState lifecycle with declared `createEffectLogic` actors. Use the same idempotency key for the first attempt and alarm recovery.

**Example:** Accept key K, commit the fold plus pending K, and answer with the committed result. Dispatch K in `ctx.waitUntil`; clear pending K only after recording its acknowledgement. If dispatch stops, the alarm resumes pending K after claiming its lease. An unknown provider outcome keeps K pending for reconciliation under the provider's real idempotency guarantee.

**Held by:** Review the commit-before-answer ordering, pending marker, alarm lease, and stable key. Use a lifecycle model test: interrupt after commit and prove alarm recovery preserves the key. No lint rule proves this ordering today.

**Incident:** In drovr on 2026-10-23, 39 of 66 ingress forward timeouts came from requests waiting on their own email send. The provider took about 10 seconds.

**In rat-stack:** `packages/core/src/join-intake.ts` commits the contact as `ready` with `pending: "delivery"`, then answers. `JoinRequest.afterResponse` runs delivery through the Worker's `waitUntil`. The marker is the durable record. `IntakeSweep` (`packages/core/src/intake-sweep.ts`) is the recovery owner: a five-minute cron reads at most 100 pending ids from the interest index and redrives each one with its submission id. Erase uses the same shape. `settleErase` in `packages/core/src/intake-erase.ts` marks `pending: "erase"`, writes the event tombstone with jittered, bounded backoff, and removes the contact only after the tombstone lands. A long Basin outage leaves the marker for the sweep. Erase wins: delivery refuses a contact marked for erase.

**Fenced by:** `packages/core/test/join-answer-at-commit.model.test.ts` fails when delivery runs before the answer, or when delivery outlives its deadline. `packages/core/test/intake-sweep.model.test.ts` interrupts delivery at generated points, erases during delivery, and takes Basin down. It fails if the contact is removed before its tombstone, if delivery ignores an erase marker, or if the sweep skips a pending delivery.

See [make operations idempotent](../../rat-stack-mode/principles/make-operations-idempotent.md) and [keep unknown distinct](../../rat-stack-mode/principles/keep-unknown-distinct.md).

**Read more:** Switchboard's recs-v0 durability review (recs 1, 4, 5, and 10). drovr-mode A7.
