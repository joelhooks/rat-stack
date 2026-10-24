# Fail open on liveness, fail closed on harm

**Applies when:** a gate, check, timeout, or dependency can stop work.

Name the harm each guard prevents. If passing it could do irreversible harm, refuse with a typed error that says what failed, why, and the next call. If the only cost is delay, retry within a bound, defer, or fall back to a known value. Never treat slow as broken.

**Why:** A refusal that guards nothing stops good work. A fallback in front of real harm lets the harm through. Each guard needs a named harm to tell the two apart.

**Effect primitive:** `Schema.TaggedError` refusals that keep the evidence, `Effect.catchTag` for the expected failure, and bounded `Effect.retry` or `Effect.timeoutOption` for delay. `Unknown` stays a separate outcome and never proves health.

**Example:** The deploy driver in `packages/deploy` does both.

- Closed on harm: `PlanRejected` refuses a replacement or deletion without an exact allow entry and owner sign-off, and names the resources.
- Open on liveness: content-version mismatches retry until a bounded deadline. A quiet window waits up to its bound before it refuses.

The Worker follows the same rule:

- A failed flag read in `apps/site/src/worker.ts` logs and uses the Config value.
- Flag audit storage failures block writes and leave reads alone.

See the [ship](/skills/ship) skill for the release procedure.

**Incident:** drovr, 2026-10-23 (drovr-mode O8 and O9). PostShiba's p50 rose from 0.3 s to 8 s, and 46 of 47 timed-out first asks still arrived. drovr settled them by lookup and did not resend. A release tripped a check outside its diff, and the desk fixed forward instead of restoring.

**Held by:** `packages/deploy/test/plan.test.ts` (unsafe actions need exact allow entries; destructive actions need owner sign-off). `packages/deploy/test/content-propagation.model.test.ts` and `packages/deploy/test/quiet-window.test.ts` (bounded waits). `packages/flags/test/kv.test.ts` (audit loss gates writes, not reads). See `skills/rat-stack-mode/principles/gates-guard-invariants.md` for where approval policy lives.

**Read more:** Switchboard's recs-v0 durability review.
