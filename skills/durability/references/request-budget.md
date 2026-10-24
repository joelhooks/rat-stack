# A request budget is not durable execution

On HTTP-triggered Cloudflare Workers, `ctx.waitUntil` can extend execution for up to **30 seconds after the response is sent or the client disconnects**. The allowance is shared across that request's waitUntil calls. It is not a total HTTP wall-time limit while a response remains active. Unsettled background work can be canceled at the end of the allowance.

Source: [Cloudflare Workers Context: waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/), checked 2026-10-23. This platform reference supplements the book bibliography; it is not a book quotation.

## Worked example: join delivery

rat-stack's join intake answers at commit and delivers to drovr after the response. Delivery used to allow three attempts at up to 20 seconds each, plus two waits of up to 3 seconds. That is about 66 seconds, and the post-response allowance is 30.

| Step | Where it lives |
| --- | --- |
| Persist an undelivered marker and stable identity before answering | `packages/core/src/join-intake.ts` saves the contact as `ready` with `pending: "delivery"` under its submission id |
| Choose one absolute deadline for the pass | `JoinDeliveryDeadline` in `packages/core/src/join-delivery-machine.ts`, default 25 seconds; `JOIN_DELIVERY_DEADLINE_SECONDS` sets 5 to 28 |
| Carry the deadline through retries; cap each attempt at the time remaining | the `deliver` actor wraps each drovr call in `Effect.timeoutOption(remaining)` |
| Start no attempt or wait once the budget is spent | the machine's retry guard compares `afterSeconds` with the remaining milliseconds |
| Clear the marker only after a settled outcome | `withState` in `packages/core/src/join-contact-store.ts` keeps `pending: "delivery"` only while the state is `ready` |
| Let a durable owner redrive undelivered work | `IntakeSweep` (`packages/core/src/intake-sweep.ts`) runs every five minutes from the Worker cron and reads at most 100 pending ids from the interest index |

Each sweep pass gets a fresh budget and keeps the submission id. drovr deduplicates by that id, so a redrive after an uncertain outcome does not create a second signup.

A numeric deadline policy can use `Context.Reference` when a default is intentional. Compute the absolute deadline for each pass; do not cache a clock-derived absolute deadline as the reference's default. The storage service remains an explicit required dependency, not a default reference.

## Proof

- `packages/core/test/join-answer-at-commit.model.test.ts` drives slow, refused, retried, and failing drovr answers on the TestClock. Background delivery must be finished when the clock reaches the deadline. Replacing the deadline with one day makes it fail.
- `packages/core/test/intake-sweep.model.test.ts` interrupts delivery at generated points, erases during delivery, and takes Basin down. The submission ends delivered or still pending, never lost. Nothing is sent after an erase request or an accepted outcome.

See [timeouts](/lore/timeouts-bound-waiting), [idempotency](/lore/retry-needs-idempotency), and [request lifetime](/lore/request-lifetime-is-not-durability). The operational distinction follows Nygard's timeouts and delayed retry and Reis and Housley's idempotency. The Worker ceiling comes from the platform documentation.
