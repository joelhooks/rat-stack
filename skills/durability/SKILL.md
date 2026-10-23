---
name: durability
description: Keep a rat-stack app standing when a provider, pool, or dependency slows down or a worker dies. Use at any I/O boundary, connection pool, provider call, shared waiter, fan-out, flag, gate, or work that can outlive a request, or when asked "what happens when this is slow", "add a timeout", "make this durable", or "what survives a crash".
plain: "Put recoverable work in storage, give recovery one owner, hold nothing across a slow call, bound every wait, and prove recovery after a crash."
diagram: |-
  request
    │ query ── lease, release
    │ commit + marker ── answer
    │   └ waitUntil ── provider
    │       one deadline
    │ sweep ── same key
    │ fan-out ── bounded
    ▼
  gates
    open on delay
    closed on harm
---

# Durability

**Effect is not BEAM.** Durability lives in storage. [Effect](/lore/effect-basics) runs each [fiber](/lore/concurrent-work-needs-an-owner) as a concurrent computation in one JavaScript runtime, not as an isolated process. Effect 4.0.0 has no OTP restart supervisor. Its structured fiber ownership is useful, but it does not rebuild lost state.

> Remember from chapters 8 and 9 that processes lose their state on termination.

Saša Jurić, _Elixir in Action_, Other Use Cases for ETS ([B2]). Even OTP restart needs a separate state-recovery decision.

A slow provider must not become our outage. Each pattern below uses an Effect primitive at a real seam. Each one has a [fence](/lore/the-fence) that fails on a planted copy of the bug. The public page is [/systems/durability](/systems/durability).

## When to use it

Load this skill before you change any of these:

- a database connection, socket, or provider SDK that a [handler](/systems/capabilities) reuses;
- a provider call that starts from a request;
- work that must survive the request, the isolate, or a deploy;
- a timeout or a retry;
- a loop or `forEach` over many items;
- a `Deferred`, `Cache`, `Ref`, `Semaphore`, `Latch`, or `PubSub` that callers share;
- a tunable that might need a deploy to change;
- a gate, check, or refusal that can stop work.

For ordinary pure functions, use [uncomplect](/skills/uncomplect). For finite modes, use [add a lifecycle machine](/skills/add-a-lifecycle-machine).

## Patterns

| # | Pattern | Principle | Example | Fence |
| --- | --- | --- | --- | --- |
| 1 | Lease a connection for the query | `principles/lease-connections-per-query.md` | `packages/database/src/connection-lease.ts` | `packages/database/test/connection-lease.test.ts` |
| 2 | Answer at commit; dispatch off the request | `principles/answer-at-commit.md` | `packages/core/src/join-intake.ts`, `packages/core/src/intake-sweep.ts` | `packages/core/test/join-answer-at-commit.model.test.ts`, `packages/core/test/intake-sweep.model.test.ts` |
| 3 | Set a provider timeout once | `principles/one-timeout-at-the-boundary.md` | `packages/subscriber-delivery/src/drovr-intake.ts`, `packages/core/src/join-delivery-machine.ts` | `packages/subscriber-delivery/test/intake-timeout.test.ts` |
| 4 | Bound work in flight | `principles/bound-in-flight-work-with-keys.md` | `apps/site/src/interest/applications.ts` | `apps/site/test/intake-applications-concurrency.test.ts` |
| 5 | Scope waiters to the request | `principles/scope-waiters-to-the-request.md` | `rat-stack-patterns/shared-waiters` | `packages/core/test/patterns-rule.test.ts` |
| 6 | Climb a flag with a ledger | `principles/climb-flags-with-a-ledger.md` | `packages/flags`, `packages/core/src/flag-change.ts` | `packages/flags/test/writes.model.test.ts`, `packages/flags/test/lifecycle.model.test.ts` |
| 7 | Fail open on liveness, closed on harm | `principles/fail-open-on-liveness.md` | `packages/deploy/src/plan.ts`, `packages/core/src/intake-erase.ts` | `packages/deploy/test/plan.test.ts`, `packages/core/test/intake-sweep.model.test.ts` |

The references hold the detail:

- [Effect map](https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/effect-map.md): each primitive, what it promises, its limit, and the version checked.
- [Request budget](https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/request-budget.md): the `waitUntil` ceiling, worked through join delivery.
- [Bibliography](https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md): the books, the chapters read, and checked quotes.

## Read the actual boundary

Read the project's instructions, the pinned versions, the [service](/lore/services-capture-dependencies), the storage [adapter](/lore/hexagonal-architecture), the acknowledgement path, and the restoration tests. Check Effect APIs against the installed source. The mappings here are our reading of Effect, not the book authors' advice about Effect.

For each accepted operation, name:

- the durable record that remains after the process disappears;
- the authority that decides its next step;
- the operation identity that every repeated side effect uses;
- the failure domain and the recovery owner;
- the acknowledgement point, and the outcome the caller can truthfully infer.

If no durable record exists, call the work best-effort. A running fiber, an in-memory queue, or a machine snapshot held only in memory is not that record.

## Work through a change

1. Name the slow thing: the provider, pool, or store, and the worst latency it can show.
2. List what the change holds while it waits: a connection, the request, a permit, or a shared waiter.
3. Name the durable record and the owner that redrives it.
4. Pick the pattern from the table. Read its principle file.
5. Put the primitive at one seam. Read the timeout from a `Context.Reference` or Config, never a literal.
6. Write a property or model test that generates the slow case and the crash.
7. Plant the bug. The test must fail. Restore the code.
8. Run `pnpm turbo run check test build`.

## Principles, ranked

Rank by risk of lost work, repeated effects, and cascading failure. The numbers are this skill's priorities, not a ranking from the books. Every Effect answer below exists in the pinned 4.0.0; the Effect map shows the check.

| Rank | Principle and action | Failure prevented | Effect answer and remaining work | Book evidence |
| --- | --- | --- | --- | --- |
| 1 | Persist accepted intent and recovery progress. Name the backend. | A healthy restarted worker silently loses accepted work. | `effect/workflow`: `Workflow`, `Activity`, `WorkflowEngine`. Select a persistent engine; `WorkflowEngine.layerMemory` is for tests. rat-stack's join intake uses a contact marker and a sweep instead. | [B1], [B2], [B3] |
| 2 | Make repeated external effects safe before enabling retries. | A crash after remote success repeats a write. | `Activity.idempotencyKey` names work. The receiver or authoritative store must enforce deduplication; drovr does it by submission id. | [B5], [B6] |
| 3 | Couple state and checkpoint where one transaction can own both. Acknowledge only the promised handoff. | A checkpoint advances past missing work, or replay reapplies committed changes. | `SqlClient.withTransaction`. No atomic transaction spans arbitrary providers. | [B5], Chs. 7, 9 |
| 4 | Give every task a lifetime owner and every failed worker a recovery owner. | Escaped tasks, unnoticed death, or endless restart churn. | `Effect.forkScoped`, `Scope`, `FiberSet`. Add restart policy in XState or a host supervisor. | [B1], [B2], [B3] |
| 5 | Bound waiting and carry the caller's remaining deadline. | Abandoned calls keep consuming scarce capacity. | `Effect.timeoutOption`. A timeout does not prove a remote write stopped. | [B4] §5.1; [B12] Ch. 22 |
| 6 | Put retries at one informed boundary, with jitter and a finite budget. | Nested loops and synchronized retries amplify an outage. | `Effect.retry` with `Schedule.exponential`, `jittered`, `recurs`, `upTo`. Shared retry accounting is separate policy. | [B4] §5.1; [B9]; [B10] §10.6; [B12] Ch. 22 |
| 7 | Bound admitted work and isolate scarce capacity by workload. | A noisy caller fills every slot and backlog grows without limit. | Bounded `Effect.forEach`, `Semaphore`, `Queue.bounded`; `Pool` for a real resource pool. | [B3]; [B4] §§5.3, 5.6 |
| 8 | Stop calling a known-unhealthy dependency and probe recovery explicitly. | Retrying doomed calls exhausts the capacity recovery needs. | No circuit-breaker API in 4.0.0. Model closed, open, and half-open in XState. | [B4] §5.2; [B11] |
| 9 | Recover from known state, with stable replay inputs and recoverable deadlines. | Restart changes old decisions or forgets scheduled work. | `Activity`, `DurableClock`, `DurableDeferred` under a persistent engine. | [B1]; [B3]; [B5] Ch. 6 |
| 10 | Preserve old payloads' meaning across deployments. | Old accepted work becomes undecodable during recovery. | `Schema.decodeUnknownEffect` decodes; an optional key keeps old records valid. Define version support and transition tests. | [B5] Ch. 3; [B14] §3.11 |
| 11 | Park exhausted or malformed work durably and give it a return path. | Poison work disappears, retries forever, or parks invisibly. | `PersistedQueue`, `DurableQueue` keep failure records. Redrive, visibility, and repair stay application work. | [B5] Ch. 9; [B9] |
| 12 | Keep expected refusals, transient faults, and defects distinct. | A crash becomes a permanent refusal, or a refusal is retried. | `Schema.TaggedError`, `Effect.catchTag`. | [B7]; [B10] Ch. 10 |
| 13 | Recycle accumulation and bound results at their source. | Retained records or a huge query exhaust storage or memory. | `Cache`, `Scope`, `Stream.take`, `PersistedQueue.layerCleanup`. Add retention and query limits. | [B4] §§4.4, 5.4 |
| 14 | Prove recovery with deterministic histories and bad dependencies. | A design passes happy-path tests but loses work at the commit and acknowledgement gap. | `TestClock`, `Deferred`, `Arbitrary`, `it.effect.prop`. Write the model, inject faults, test real storage separately. | [B4] §5.7; [B11]; [B15] |
| 15 | Observe useful outcomes, backlog, and saturation. | Fast failures, parked work, or growing queues look healthy. | `Metric.counter`, `gauge`, `histogram`. Dashboards and alerts sit outside the constructors. | [B8]; [B12] Ch. 26 |

> Protect critical clients by giving them their own pool to call.

Michael T. Nygard, _Release It!_, §5.3 ([B4]). One global limit does not reserve capacity for critical work.

## Choose what owns recovery

This is house composition, not a claim that the authors recommend these products.

| Need | Use | Do not claim |
| --- | --- | --- |
| Process-local resource and child lifetime | Effect `Scope`, acquire and release, scoped fibers | Cleanup after hard process death, separate heaps, or automatic restart |
| Post-response Worker work | `ctx.waitUntil` for bounded best-effort work; persist required work before responding | More than the 30-second shared allowance, or recovery after cancellation |
| Legal modes, retry and cancel events, restart thresholds | XState 6 with `@xstate/effect` | That a machine alone is a durable store or an OS supervisor |
| Per-entity durable state | A Durable Object adapter behind an Effect service | That an in-memory field or local timer survives restart |
| Authoritative relational state, dedupe ledger, checkpoint, or outbox | A Postgres adapter with explicit transaction and uniqueness contracts | That a local transaction includes a remote provider's side effect |
| Durable multi-step orchestration with no recovery owner yet | Effect workflow engine with persistent storage | That `layerMemory`, a detached fiber, or an API named Durable proves production durability |
| Heap, CPU, or fatal-runtime isolation | A separate process, worker, or service with a host recovery policy | That a `Scope`, `FiberSet`, or machine gives BEAM isolation |

Keep one recovery authority for each operation. When an existing Durable Object or database already owns progress, adapt it; do not add a second ledger by default.

`Effect.forkDetach` is the detached-fiber name in 4.0.0; there is no `forkDaemon`. Detaching changes lifetime inside a live runtime. It does not persist work.

## Check the uncomfortable boundaries

Use the guarantee the [contract](/systems/capabilities) promises, not a generic claim of exactly-once execution.

| Boundary | Evidence to collect |
| --- | --- |
| Accepted, not yet started | Kill the worker. The accepted identity stays discoverable in the durable store. |
| Remote effect succeeded, local result missing | Retry the same identity. Show receiver deduplication or reconciliation. If neither exists, record the outcome as uncertain. |
| State committed, acknowledgement missing | Redeliver. Prove state does not apply twice. |
| Retry exhausted | Show a durable failure record, a visible owner, and a tested redrive. |
| Timer pending at crash | Recover the persisted deadline. Test wakeup and cancellation. |
| Old payload after deploy | Decode retained fixtures across versions. |
| Dependency slow, absent, or malformed | Check the deadline, admission, typed failure, breaker transition, and capacity release. |

These are proposed checks derived from the cited failure modes. Passing an in-memory test does not prove the backend's crash contract.

## Related skills

- [uncomplect](/skills/uncomplect): a held resource and a provider call in one scope are a braid to separate.
- [add-a-lifecycle-machine](/skills/add-a-lifecycle-machine): retries, backoff modes, breakers, and a degraded provider are lifecycles.
- [investigate-a-failure](/skills/investigate-a-failure): before raising a timeout, join the failure to the calls in flight.
- [ship](/skills/ship): the deploy driver's typed refusals and bounded waits hold pattern 7.

## Finish

Report the persistence owner, recovery owner, operation identity, acknowledgement boundary, remaining uncertainty, and checks run. Name what the design deletes. Leave a missing guarantee explicit.

## Bibliography

The [full bibliography](https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md) lists the chapters read, edition notes, and every checked quote.

- **[B1]** Martin Logan, Eric Merritt, Richard Carlsson. _Erlang and OTP in Action_. The Erlang/OTP Platform: Let It Crash. "The point of letting an entire subsystem terminate and be restarted is that it brings you back to a state known to function properly."
- **[B2]** Saša Jurić. _Elixir in Action_, third edition. Chapters 8–9; Other Use Cases for ETS. "Remember from chapters 8 and 9 that processes lose their state on termination."
- **[B3]** James Edward Gray II, Bruce A. Tate. _Designing Elixir Systems with OTP_. Customize Your Lifecycle. "Elixir can’t manage what it doesn’t know about."
- **[B4]** Michael T. Nygard. _Release It!_ (2007). §5.1 Timeouts. "The timeout is a simple mechanism allowing you to stop waiting for an answer once you think it will not come."
- **[B5]** Adam Bellemare. _Building Event-Driven Microservices_. Chapter 6, Deterministic Stream Processing. "The overarching goal of deterministic processing is that a microservice should produce the same output whether it is processing in real time or catching up to the present time."
- **[B6]** Joe Reis, Matt Housley. _Fundamentals of Data Engineering_. Chapter 5, Message Queues. "In an idempotent system, the outcome of processing a message once is identical to the outcome of processing it multiple times."
- **[B7]** Scott Wlaschin. _Domain Modeling Made Functional_. Working with Errors. "These different kinds of errors require different implementations."
- **[B8]** Rob Ewaschuk. _Monitoring Distributed Systems_. The Four Golden Signals. "The four golden signals of monitoring are latency, traffic, errors, and saturation."
- **[B9]** Peter Sbarski, Yan Cui, Ajay Nair. _Serverless Architectures on AWS_, second edition. Chapter 6, Everything Fails, All the Time. "Do you put the failed event into a DLQ and process it later?"
- **[B10]** John Ousterhout. _A Philosophy of Software Design_. §10.3 Define Errors Out of Existence. "Rather than throwing an error when unset is asked to delete an unknown variable, it should have simply returned without doing anything."
- **[B11]** Fred Hebert. _Property-Based Testing with PropEr, Erlang, and Elixir_. Laying Out Stateful Properties. "Both function calls must be deterministic."
- **[B12]** Betsy Beyer, Chris Jones, Jennifer Petoff, Niall Richard Murphy, editors. _Site Reliability Engineering_. Chapter 22, Addressing Cascading Failures. No checked quote.
- **[B13]** Eric Normand. _Grokking Simplicity_. Chapters 15–17, timelines. No checked quote.
- **[B14]** Scott W. Ambler, Pramod J. Sadalage. _Refactoring Databases_. §3.11. "many refactorings require you to run both the original and new versions of the schema in parallel during a transition period that is long enough to allow any applications accessing that portion of the schema time to be redeployed."
- **[B15]** Titus Winters, Tom Manshreck, Hyrum Wright, editors. _Software Engineering at Google_. Chapter 15, Deprecation. No checked quote.
- **[B16]** Andreas Zeller. _Why Programs Fail_. Chapter 4, Reproducing the Problem Environment. No checked quote.

[B1]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b1-erlang-and-otp-in-action
[B2]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b2-elixir-in-action
[B3]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b3-designing-elixir-systems-with-otp
[B4]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b4-release-it
[B5]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b5-building-event-driven-microservices
[B6]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b6-fundamentals-of-data-engineering
[B7]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b7-domain-modeling-made-functional
[B8]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b8-monitoring-distributed-systems
[B9]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b9-serverless-architectures-on-aws
[B10]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b10-a-philosophy-of-software-design
[B11]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b11-property-based-testing
[B12]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b12-site-reliability-engineering
[B14]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b14-refactoring-databases
[B15]: https://github.com/joelhooks/rat-stack/blob/main/skills/durability/references/bibliography.md#b15-software-engineering-at-google
