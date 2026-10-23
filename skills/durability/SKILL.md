---
name: durability
description: Keep a rat-stack app standing when a provider, pool, or dependency slows down. Use at any I/O boundary, connection pool, provider call, shared waiter, fan-out, flag, or gate, or when asked "what happens when this is slow", "add a timeout", or "make this durable".
plain: "Hold nothing across a slow call, answer at commit, set each timeout once, bound fan-out, scope waiters, climb flags, and stop only on harm."
diagram: |-
  request
    │ query ── lease, release
    │ commit ── answer
    │   └ waitUntil ── provider
    │       one timeout
    │       backstop: same key
    │ fan-out ── bounded
    ▼
  gates
    open on delay
    closed on harm
---

# Durability

A slow provider must not become our outage. Each pattern below uses an [Effect](/lore/effect-basics) primitive at a real seam. Each one has a [fence](/lore/the-fence) that fails on a planted copy of the bug.

Read `AGENTS.md` first. The public page is [/systems/durability](/systems/durability). Its cards carry the incident behind each pattern.

## When to use it

Load this skill before you change any of these:

- a database connection, socket, or provider SDK that a [handler](/systems/capabilities) reuses;
- a provider call that starts from a request;
- a timeout;
- a loop or `forEach` over many items;
- a `Deferred`, `Cache`, `Ref`, or `Semaphore` that callers share;
- a tunable that might need a deploy to change;
- a gate, check, or refusal that can stop work.

## Patterns

| # | Pattern | Principle | Example | Fence |
| --- | --- | --- | --- | --- |
| 1 | Lease a connection for the query | `principles/lease-connections-per-query.md` | `packages/database/src/connection-lease.ts` | `packages/database/test/connection-lease.test.ts` |
| 2 | Answer at commit; dispatch off the request | `principles/answer-at-commit.md` | `packages/core/src/join-intake.ts`, `apps/site/src/interest/join-request.ts` | `packages/core/test/join-answer-at-commit.model.test.ts` |
| 3 | Set a provider timeout once | `principles/one-timeout-at-the-boundary.md` | `packages/subscriber-delivery/src/drovr-intake.ts` | `packages/subscriber-delivery/test/intake-timeout.test.ts` |
| 4 | Bound work in flight | `principles/bound-in-flight-work.md` | `apps/site/src/interest/applications.ts` | `apps/site/test/intake-applications-concurrency.test.ts` |
| 5 | Scope waiters to the request | `principles/scope-waiters-to-the-request.md` | drovr ships it | a `rat-stack-patterns` lint rule (drovr ships it) |
| 6 | Climb a flag with a ledger | `principles/climb-flags-with-a-ledger.md` | `packages/flags`, `packages/core/src/flag-change.ts` | `packages/flags/test/writes.model.test.ts`, `packages/flags/test/lifecycle.model.test.ts` |
| 7 | Fail open on liveness, closed on harm | `principles/fail-open-on-liveness.md` | `packages/deploy/src/plan.ts` | `packages/deploy/test/plan.test.ts`, `packages/deploy/test/content-propagation.model.test.ts` |

## Work through a change

1. Name the slow thing: the provider, pool, or store, and the worst latency it can show.
2. List what the change holds while it waits: a connection, the request, a permit, or a shared waiter.
3. Pick the pattern from the table. Read its principle file.
4. Put the primitive at one seam. Read the timeout from a `Context.Reference` or Config, never a literal.
5. Write a property or model test that generates the slow case.
6. Plant the bug. The test must fail. Restore the code.
7. Run `pnpm turbo run check test build`.

## Related skills

- [uncomplect](/skills/uncomplect): a held resource and a provider call braided into one scope are a braid to separate.
- [add-a-lifecycle-machine](/skills/add-a-lifecycle-machine): retries, backoff modes, and a degraded provider are lifecycles.
- [investigate-a-failure](/skills/investigate-a-failure): before raising a timeout, join the failure to the calls in flight.
- [ship](/skills/ship): the deploy driver's typed refusals and bounded waits hold pattern 7.

## Bibliography

A research synthesis fills this section. Until then, each principle file cites the incident it came from.

- _Placeholder._
