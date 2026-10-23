# Answer at commit; dispatch off the request

**Status:** placeholder. drovr writes the rule, the why, and the incident. The desk filled in the example and the fence.

**Applies when:** a request must start provider work.

**Effect primitive:** `Cloudflare.WorkerExecutionContext.waitUntil` at the edge, with a backstop that replays the same idempotency key.

**Example:** `packages/core/src/join-intake.ts` commits the contact as `ready`, hands delivery to `JoinRequest.afterResponse`, and answers. `apps/site/src/interest/join-request.ts` binds `afterResponse` to the Worker's `waitUntil`. When the background work never settles, the contact stays `ready`. `intakeRedeliver` (`packages/core/src/intake-redeliver.ts`) then replays it with the same submission id.

**Held by:** `packages/core/test/join-answer-at-commit.model.test.ts`. The model generates drovr latencies, outcomes, and dropped background work. If delivery runs before the answer, it fails.
