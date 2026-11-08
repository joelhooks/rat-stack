# Answer at commit, dispatch off the request

**Applies when:** a Durable Object accepts work that needs an external provider.

Commit the fold and its pending-dispatch marker before answering the caller. The Durable Object owns the durable state; provider responses are acknowledgements, not the system of record. Schedule the first provider attempt with `ctx.waitUntil` under the accepted operation's idempotency key. Keep a durable marker and an alarm lease as the recovery path. A background promise alone does not make accepted work durable.

**Why:** Waiting for the provider makes request latency depend on delivery latency. A lost response can make the caller retry work that already committed.

**Effect primitive:** Describe dispatch as a named `Effect.fn` and run it at the platform boundary for `ctx.waitUntil`. Keep retries and cancellation in an XState lifecycle with declared `createEffectLogic` actors. Use the same idempotency key for the first attempt and alarm recovery.

**Example:** Accept key K, commit the fold plus pending K, and answer with the committed result. Dispatch K in `ctx.waitUntil`; clear pending K only after recording its acknowledgement. If dispatch stops, the alarm resumes pending K after claiming its lease. An unknown provider outcome keeps K pending for reconciliation under the provider's real idempotency guarantee.

**Held by:** Review the commit-before-answer ordering, pending marker, alarm lease, and stable key. Use a lifecycle model test: interrupt after commit and prove alarm recovery preserves the key. No lint rule proves this ordering today.

**Incident:** In drovr on 2026-10-23, 39 of 66 ingress forward timeouts came from requests waiting on their own email send. The provider took about 10 seconds.

**In rat-stack:** the normal path in `packages/core/src/join-intake.ts` saves the contact as `ready` with `pending: "delivery"` before answering. `JoinRequest.afterResponse` runs delivery through `waitUntil`. A five-minute `IntakeSweep` reads at most 100 pending ids from the interest index and redrives them with their submission ids. `settleErase` keeps an erase marker until the event tombstone lands, then removes the contact. A deliverer that reads an erase marker refuses delivery.

**Known gap:** the record and sweep index live in separate Durable Objects. A failed index write can strand pending work. An early erase can prevent the ready commit while the uniform answer still leaves. `packages/core/spec/README.md` describes these counterexamples and the operator redrive. The join implementation does not yet meet the atomic recovery rule above.

**Fenced by:** `packages/core/test/join-answer-at-commit.model.test.ts` fails when delivery runs before the answer, or when delivery outlives its deadline. `packages/core/test/intake-sweep.model.test.ts` interrupts delivery at generated points, erases during delivery, and takes Basin down. It fails if the contact is removed before its tombstone, if delivery ignores an erase marker, or if the sweep skips a pending delivery.

See [make operations idempotent](../../rat-stack-mode/principles/make-operations-idempotent.md) and [keep unknown distinct](../../rat-stack-mode/principles/keep-unknown-distinct.md).

**Read more:** Switchboard's recs-v0 durability review (recs 1, 4, 5, and 10). drovr-mode A7.
