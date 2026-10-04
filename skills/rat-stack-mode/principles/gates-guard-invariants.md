# Make gates guard invariants

**Applies when:** adding a gate or approval check.

Name a gate's domain invariant and proof; keep approval policy on the contract. Reporting failures must not gate unrelated execution without an explicit product requirement.

**Why:** A check without a protected behavior adds process but not trust.

**Example:** `packages/capability/src/implement.ts` gates approval-required handlers before they run.

**Held by:** `ApprovalDenied`; `packages/capability/test/to-rpc.test.ts`; review for new gates.
