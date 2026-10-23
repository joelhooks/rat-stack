# Bound in-flight work with keys

**Applies when:** a shard dispatches independent items to an external provider.

Give each shard a measured concurrency budget N. Keep each item's idempotency key through dispatch, acknowledgement, retries, and recovery. The shard owns its durable pending items and acknowledgement cursor. Advance that cursor only past a contiguous sequence of acknowledged items. An in-memory permit count is not a durable receipt.

**Why:** One item in flight ties throughput to provider latency. Unbounded dispatch can exceed provider capacity; advancing past an unacknowledged item can lose work. Concurrency and rate limits control different quantities. Keep both when the provider needs both.

**Effect primitive:** Use a shard-owned `Semaphore.make(N)` with `withPermits(1)`, or `Effect.forEach(items, dispatch, { concurrency: N })`. Construct the semaphore inside the owner's Effect or Layer body, never in a module binding. Choose N from measured latency and provider limits; do not copy an incident's value as a default.

**Example:** Dispatch keys A, B, and C within N permits. If B and C finish before A, persist their acknowledgements but keep the cursor before A. Once A is acknowledged, advance through C. Recovery reuses each pending item's original key.

**Held by:** `rat-stack-patterns/shared-waiters` rejects module-owned waiting primitives, including Effect-run results. Review concurrency separately from rate limiting. Use a lifecycle model test with reordered acknowledgements and interruption; prove the cursor never skips pending work. The lint rule does not prove a concurrency budget or cursor ordering.

**Incident:** In drovr on 2026-10-23, each shard kept only one ask in flight. Throughput equalled shards divided by provider latency: about 90 per minute against a 150-per-minute setting.

See [give mutable partitions one writer](one-writer-per-partition.md) and [measure real limits](measure-real-limits.md).
