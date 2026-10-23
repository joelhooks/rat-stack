# Climb a flag one rung at a time, and keep a ledger

**Applies when:** shipping new behavior dark, or changing a tunable that would otherwise need a deploy.

Merge new behavior behind a typed flag at its lowest rung. Climb one rung at a time through the approval-gated writer. Each write leaves a ledger entry that names the caller, the old value, the new value, and the outcome. Keep deploy-time settings as deploys.

**Why:** A deploy to change one value costs a plan, a readback, and another deploy to undo it. A rung climbs on recorded evidence, and going back is one call.

**Effect primitive:** A `Context.Service` port in core, Config and memory adapters as `Layer`s, and a declared XState lifecycle whose transitions run as `createEffectLogic` actors.

**Example:** The flags cartridge keeps a ladder and a ledger.

- Ladder: the lifecycle `declared → rollingOut → on → removed`, with percentage rules that keep each subject in its bucket as the share grows.
- Ledger: `setFlag` writes an immutable Pending key before the approval gate. A separate completion key records success, denial, failure, or interruption.
- `EVENTS_ENABLED` stays deploy-time Config, and live writes cannot change it.

rat-stack has no named rungs beyond this lifecycle. Add them only when a child project needs them.

**Incident:** drovr, 2026-10-23 (drovr-mode O7). A timeout change shipped as a constant by deploy. Joel: "crazy we arent using feature flags 😭". drovr then shipped `postshiba-send-hold` dark, with the rungs off, release, and release-30s.

**Held by:** `packages/flags/test/writes.model.test.ts` audits every available-store attempt in generated histories. `packages/flags/test/lifecycle.model.test.ts` never changes a removed flag. `packages/flags/test/kv.test.ts` keeps a Pending attempt when completion fails. `rat-stack-patterns` rejects a flag without a literal removal date.

**Read more:** Switchboard's recs-v0 durability review.
