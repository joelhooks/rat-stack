# Climb a flag one rung at a time, and keep a ledger

**Applies when:** shipping new behavior dark, or changing a tunable that would otherwise need a deploy.

Merge new behavior behind a typed flag at its lowest rung. Climb one rung at a time through the approval-gated writer. Each write leaves a ledger entry that names the caller, the old value, the new value, and the outcome. Keep deploy-time settings as deploys.

**Why:** A deploy to change one value costs a plan, a readback, and another deploy to undo it. A rung climbs on recorded evidence, and going back is one call.

**Effect primitive:** A `Context.Service` port in core, Config and memory adapters as `Layer`s, and a declared XState lifecycle whose transitions run as `createEffectLogic` actors.

**Example:** The flags cartridge keeps a ladder and a ledger.

- Each flag declares named rungs, authority roles, exit evidence, and a read-scope schema.
- Evidence qualifies only its own scope and current rung.
- `flip_feature_flag` climbs one rung through capability approval. Climbs above agent also record an approval quote.
- The Durable Object commits the position, receipt, and projection marker together. Alarms redrive failed or interrupted KV projection.
- Readers use KV, never the ledger. KV propagation makes this unsuitable for an immediate safety stop.
- An immutable Pending record precedes approval. A separate completion record preserves success, denial, failure, or interruption.
- `off` follows the catalog kill policy and passes even when approval is denied. It remains audited.
- Operator authentication runs before dispatch, outside approval.
- `EVENTS_ENABLED` stays deploy-time Config, and live writes cannot change it.

The explicit KV fallback lacks atomic commit and cross-isolate serialization. Use the Durable Object adapter for authoritative writes. See [add-a-feature-flag](/skills/add-a-feature-flag) for declarations and composition.

**Incident:** drovr, 2026-10-23 (drovr-mode O7). A timeout change shipped as a constant by deploy. Joel: "crazy we arent using feature flags 😭". drovr then shipped `postshiba-send-hold` dark, with the rungs off, release, and release-30s.

**Held by:** `packages/flags/test/writes.model.test.ts` audits every available-store attempt in generated histories. `packages/flags/test/lifecycle.model.test.ts` never changes a removed flag. `packages/flags/test/kv.test.ts` keeps a Pending attempt when completion fails. `rat-stack-patterns` rejects a flag without a literal removal date.

**Read more:** Switchboard's recs-v0 durability review.
