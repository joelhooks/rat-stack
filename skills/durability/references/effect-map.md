# Effect map: execution is not persistence

rat-stack pins `effect@4.0.0`. Switchboard drafted this map against the `effect@4.0.5` source (commit `7f524e25cfb49a71ac39b0f44278d08d40dda5de`). Every row was then checked against the installed 4.0.0 type declarations in `packages/core/node_modules/effect/dist/*.d.ts`. The **Checked** column names both. No row is 4.0.5-only. These are our mappings from the cited books to this library. The books do not discuss Effect.

Source paths are repository-relative to Effect-TS/effect. Workflow, cluster, and persistence modules carry unstable annotations even without an `unstable/` import segment. This is a versioned reference, not an instruction to upgrade.

## Primitive map

| Job | Import and symbols | Source | Contract and limit | Checked |
| --- | --- | --- | --- | --- |
| Lifetime and cleanup | `effect/Scope`; `effect/Effect`: `acquireRelease`, `forkScoped` | `packages/effect/src/Scope.ts`; `packages/effect/src/Effect.ts` | A Scope owns finalizers and scoped fibers. Release registration follows successful acquisition. A hard process kill cannot run local finalizers. | 4.0.0 `.d.ts`, 4.0.5 source |
| Shared resource lifetime | `effect/RcRef`: `idleTimeToLive` option | `packages/effect/src/RcRef.ts` | Reference-counted sharing with an idle release delay; not a pool of independent resources or a durable lease across hosts. | 4.0.0 `.d.ts`, 4.0.5 source |
| Resource pool | `effect/Pool` | `packages/effect/src/Pool.ts` | A pool owns acquired resources. A Semaphore only controls permits. Neither persists accepted jobs. | 4.0.0 `.d.ts`, 4.0.5 source |
| Managed fiber group | `effect/FiberSet` | `packages/effect/src/FiberSet.ts` | Scoped collection and failure observation, not restart strategies or restart-intensity accounting. | 4.0.0 `.d.ts`, 4.0.5 source |
| Detached lifetime | `effect/Effect`: `forkDetach` | `packages/effect/src/Effect.ts` | Uses the global scope rather than parent lifetime. Runtime death still loses execution. Neither 4.0.0 nor 4.0.5 exports `forkDaemon`. | 4.0.0 `.d.ts`, 4.0.5 source |
| Retry | `effect/Effect`: `retry`; `effect/Schedule`: `exponential`, `jittered`, `recurs`, `upTo` | `packages/effect/src/Effect.ts`; `packages/effect/src/Schedule.ts` | Explicitly compose jitter and finite attempt/duration bounds. This controls repetition, not side-effect safety or shared retry budgets. | 4.0.0 `.d.ts`, 4.0.5 source |
| Timeout | `effect/Effect`: `timeout`, `timeoutOption` | `packages/effect/src/Effect.ts` | Bounds local waiting through interruption. Foreign work must cooperate with cancellation. A lost response does not establish remote nonexecution. | 4.0.0 `.d.ts`, 4.0.5 source |
| Active-work cap | `effect/Effect`: `forEach` concurrency option; `effect/Semaphore` | `packages/effect/src/Effect.ts`; `packages/effect/src/Semaphore.ts` | Limit simultaneous work. A cap does not bound every upstream waiting producer or reserve critical capacity unless partitioned. | 4.0.0 `.d.ts`, 4.0.5 source |
| Local queue and overflow | `effect/Queue`: `bounded`, `dropping`, `sliding` | `packages/effect/src/Queue.ts` | Bounded queues suspend producers by default; dropping rejects new entries; sliding discards old entries. None supplies persistent delivery. | 4.0.0 `.d.ts`, 4.0.5 source |
| Runtime coordination/cache | `effect/Deferred`; `effect/Cache` | `packages/effect/src/Deferred.ts`; `packages/effect/src/Cache.ts` | Shares local outcomes or cached results. Not a crash-surviving dedupe ledger. Scope ownership to the actual runtime/platform contract. | 4.0.0 `.d.ts`, 4.0.5 source |
| Stream consumption | `effect/Stream`: `runForEach`, `take` | `packages/effect/src/Stream.ts` | Composition and bounded consumption do not persist offsets or limit a driver's already-materialized query result. | 4.0.0 `.d.ts`, 4.0.5 source |
| Boundary validation and failure | `effect/Schema`: `TaggedError`, `decodeUnknownEffect`; `effect/Effect`: `catchTag` | `packages/effect/src/Schema.ts`; `packages/effect/src/Effect.ts` | Typed expected failures and runtime decoding; not domain classification, semantic reconciliation, or storage isolation. | 4.0.0 `.d.ts`, 4.0.5 source |
| Independent validation failures | `effect/Effect`: `validate` | `packages/effect/src/Effect.ts` | Runs independent checks and collects failures. Ordinary sequencing should not be described as accumulating all errors. This resolves a reader's unverified API gap. | 4.0.0 `.d.ts`, 4.0.5 source |
| Optional policy default | `effect/Context`: `Reference` | `packages/effect/src/Context.ts` | A lazily computed cached default is useful for optional policy values. Compute fresh absolute deadlines per run; required storage authority stays a required service. | 4.0.0 `.d.ts`, 4.0.5 source |
| Service seam | `effect/Context`: `Service`; `effect/Layer` | `packages/effect/src/Context.ts`; `packages/effect/src/Layer.ts` | Wires dependencies and construction lifetimes. Does not supervise restarts or provision independent failure domains. | 4.0.0 `.d.ts`, 4.0.5 source |
| Database transaction | `effect/sql/SqlClient`: `SqlClient.withTransaction` | `packages/effect/src/sql/SqlClient.ts` | Database/adapter transaction boundary. It does not atomically commit an arbitrary broker's offset or remote API write. Do not confuse database transactions with in-memory transactional state. | 4.0.0 `.d.ts`, 4.0.5 source |
| Workflow and activity | `effect/workflow`: `Workflow`, `Activity`, `WorkflowEngine` | `packages/effect/src/workflow/index.ts`; `Workflow.ts`; `Activity.ts`; `WorkflowEngine.ts` in that directory | Stable workflow identity and named activity results managed by the engine. The selected backend determines crash survival. | 4.0.0 `.d.ts`, 4.0.5 source |
| Memory workflow engine | `effect/workflow/WorkflowEngine`: `layerMemory` | `packages/effect/src/workflow/WorkflowEngine.ts` | Explicitly for tests/development where durability is not needed. It is not a production durability backend. | 4.0.0 `.d.ts`, 4.0.5 source |
| Workflow identity | `Workflow` idempotency-key configuration; `Activity.idempotencyKey` | `packages/effect/src/workflow/Workflow.ts`; `packages/effect/src/workflow/Activity.ts` | Names execution/activity work. The receiver must honor a key to prevent repeated external effects. | 4.0.0 `.d.ts`, 4.0.5 source |
| Durable timer/signal | `effect/workflow`: `DurableClock`, `DurableDeferred` | `packages/effect/src/workflow/DurableClock.ts`; `packages/effect/src/workflow/DurableDeferred.ts` | Workflow timer and completion protocols through the engine, not persistence of arbitrary local timers or promises. | 4.0.0 `.d.ts`, 4.0.5 source |
| Persisted work | `effect/persistence/PersistedQueue`; `effect/workflow/DurableQueue` | `packages/effect/src/persistence/PersistedQueue.ts`; `packages/effect/src/workflow/DurableQueue.ts` | Queue store and engine configuration matter. DurableQueue explicitly documents at-least-once delivery and idempotent-handler requirements. | 4.0.0 `.d.ts`, 4.0.5 source |
| Queue maintenance | `PersistedQueue.layerCleanup` | `packages/effect/src/persistence/PersistedQueue.ts` | Completed entries retain dedupe history for a configured period; failed entries are retained unless a failed-retention policy is configured. Cleanup should have one deployment owner. | 4.0.0 `.d.ts`, 4.0.5 source |
| Cluster-backed orchestration | `effect/cluster`: `ClusterWorkflowEngine`, entity/sharding modules | `packages/effect/src/cluster/index.ts`; `packages/effect/src/cluster/ClusterWorkflowEngine.ts` | Adapts workflow execution to cluster sharding and message storage. It is not a replicated database, general consensus proof, or transparent BEAM distribution. | 4.0.0 `.d.ts`, 4.0.5 source |
| Virtual time and synchronization | `effect/testing/TestClock`: `adjust`; `effect/Deferred` | `packages/effect/src/testing/TestClock.ts`; `packages/effect/src/Deferred.ts` | Drives Effect-clock timers and explicit test coordination. Does not control a foreign library's unrelated wall-clock timers. | 4.0.0 `.d.ts`, 4.0.5 source |
| Generated histories | `effect/Arbitrary`: `checkEffect`; `@effect/vitest` property tests | `packages/effect/src/Arbitrary.ts`; `packages/vitest/src/index.ts` | Property execution and shrinking; author the transition model, fixtures, preconditions, and invariants. Not a ready-made PropEr state-machine engine. | 4.0.0 `.d.ts`, 4.0.5 source |
| Service signals | `effect/Metric`: `counter`, `gauge`, `histogram` | `packages/effect/src/Metric.ts` | Supplies instruments. It does not define the service's SLO, alert policy, backlog adapter, or operator response. | 4.0.0 `.d.ts`, 4.0.5 source |

## Two recovery traps in the actual source

**A dead-lettered DurableQueue item can park its workflow.** The module header says that exhausted items leave their DurableDeferred unresolved. The workflow stays parked until out-of-band requeue. Replaying submission is not a redrive protocol because the failed identity remains deduplicated. Design repair, requeue, and visibility together. Source: `packages/effect/src/workflow/DurableQueue.ts`.

**A local timer is not a durable timer.** DurableClock delegates longer workflow sleeps to the engine and runs short sleeps through an in-memory activity. Its behavior must be read with the engine's persistence contract. Do not infer that every timer created anywhere in an application is now recoverable. Source: `packages/effect/src/workflow/DurableClock.ts`.

## What the source does not establish

- No OTP restart supervisor exists. Neither 4.0.0's declarations nor the 4.0.5 source export a `Supervisor`. The Effect source does call parent-child cleanup auto supervision; that means lifetime attachment, not restart-on-failure strategies.
- No dependency circuit-breaker API exists in 4.0.0 or 4.0.5. Searching `CircuitBreaker` returned no matches. A lowercase circuit-breaker comment in the arbitrary generator concerns duplicate generation, not dependency health.
- No fiber API in this map creates private heaps or protects against a shared runtime's fatal failure.
- Workflow replay does not make an arbitrary remote side effect exactly once. DurableQueue's source expressly describes the success-before-acknowledgement crash window.
- Database recovery, backup verification, remote deduplication, alarm recovery, and machine restoration need their own adapter evidence.

## House composition, not library guarantees

Use XState to name lifecycle and breaker policy; use the selected host for process restart. Persist the state needed to restore those decisions. Use Durable Object storage and alarms when they already own an entity's recovery. Use Postgres for transactional domain state, checkpoint/dedupe records, or an outbox when that fits the boundary. Neither choice creates atomicity with a remote provider.

Keep provider calls outside the authoritative database transaction in this proposed composition. Treat that as our design choice, not a rule attributed to a thin book excerpt.

The [request budget](request-budget.md) names the HTTP Worker waitUntil ceiling. Its worked example is the join delivery deadline and the intake sweep.

The [bibliography](bibliography.md) supplies the underlying principles. Read [the skill](../SKILL.md) for their ranked application.
