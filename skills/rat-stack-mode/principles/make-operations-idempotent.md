# Make retryable operations idempotent

**Applies when:** replaying commands or recovering after crashes.

Define what repeating an operation means and what happens after each partial failure. Use stable operation identity and reconciliation where redelivery must not duplicate effects.

**Why:** Retries are safe only when repeated execution has defined behavior.

**Example:** `packages/core/test/join-interest.test.ts` checks repeat submission and crashed delivery. `RunLog.record` creates a fresh id, so it is not replay-idempotent.

**Held by:** `packages/core/test/join-interest.test.ts`; `packages/core/test/join-delivery-machine.model.test.ts`; review for other operations.

**Prior art:** Adapted from pstack's `principle-make-operations-idempotent` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
