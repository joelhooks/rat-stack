---
name: query-design
description: Design or review SQL reads, writes, scans, backfills, and slow database paths. Use before changing a store method or any loop that queries. Covers round-trip arithmetic, batching, keyset paging, index evidence, row budgets, PlanetScale Vitess limits, Hyperdrive connections, statement-count tests, and statement-template fences.
plain: "Count round trips first, bound each query, prove its index, and make tests catch extra statements."
diagram: |-
  question + caller + rate
    │ round-trip arithmetic
    ▼
  bounded store operations
    │ page parents
    │ batch children
    ▼
  EXPLAIN + count test
    │ manifest + plan fence
    ▼
  measured run + progress
terms:
  - "query design"
  - "round trip"
  - "keyset pagination"
  - "statement template"
prerequisites:
  - "/skills/add-a-store"
---

# Design queries around round trips

Count round trips before writing SQL. Small tables can still produce slow runs when each row needs several database calls.

```text
round trips per call × calls per run × RTT = wall time
```

RTT means round-trip time. This arithmetic estimates serial network time; query execution, decoding, and connection acquisition add costs.

Consider an illustrative scan of about 9k threads:

- Per-thread reads: 5 round trips × about 9.3k threads × 81 ms ≈ 63 minutes.
- Paged and batched reads: 2 round trips × 93 pages × about 100 ms ≈ 20 seconds.
- These are planning inputs. Measure RTT where the caller runs before choosing its budget.

A [capability](/systems/capabilities) call has a constant round-trip budget, independent of result size. State that number and bound its result. A scan costs O(pages), never O(rows). Count transaction control statements and any final empty-page probe too.

Done means the store implementation matches a written query plan, and checks detect violations of its statement and access-path budgets.

## 1. Name the question, caller, and rate

Record these before changing the store:

- **Question**: The fact or change the caller needs
- **Caller**: Capability, scan, export, or background job
- **Rate**: Calls per invocation and invocations per second or run
- **Authority**: System of record, derived copies, and writer
- **Row budget**: Maximum rows read with tables at 100× today's size
- **Statements**: Round trips per call, per page, and per run
- **Timing**: Measured RTT, predicted wall time, and observed page time
- **Concurrency**: Maximum simultaneous queries or transactions

Measure table sizes and inspect existing indexes. Keep credentials and row contents out of measurements and reports. Route operator, export, and monitor reads to a replica or a copy. Record any consistency tradeoff. Compare repeated joins or aggregates with a keyed [read model](/skills/add-a-store) before adding a hot-path scan.

## 2. Apply the shared rules

1. **Never query inside a loop over rows.** Page parents, fetch their children with one batched `IN`, then join in memory. Apply the same authorization filter to both queries. Keep analysis pure over the fetched rows. Bound child fan-out and result bytes too. Page children separately when one parent can exceed the batch budget.
2. **Use keyset paging, never OFFSET.** Order by an indexed tuple that ends in a unique column. Match the cursor predicate to each column's sort direction. Fetch `limit + 1` to detect another page. Emit a cursor from the last returned row. Exclude the extra probe row from the returned page.
3. **Name each query's index and prove it with EXPLAIN.** Use representative data and the actual query builder. Record the chosen `key`, access `type`, estimated `rows`, and sorting work for MySQL. Expect `const`, `eq_ref`, `ref`, `range`, or an index-ordered limit that meets the row budget. Equivalent plan fields apply to other engines. Inspect examined rows when the engine supports execution analysis. Fix full scans or filesorts on growing tables. Justify any index hint with plan evidence.
4. **Select only columns the caller uses.** Keep large bodies, JSON, and text fields out of counts and metadata scans.
5. **Keep transactions short.** Name the atomic writes or consistent reads that require one. Never wrap an entire scan in a transaction. Keep external I/O outside the transaction.
6. **State a concurrency bound.** Start production scans with serial pages over one connection. Measure before adding parallelism. Explain the load budget and why more concurrent work helps.
7. **Show progress on long runs.** Emit phase, completed pages, counts, and elapsed time to stderr. Use counts-only output. Set a measured stall deadline and return a typed failure with phase and completed count.
8. **Use a store boundary.** A [port](/lore/hexagonal-architecture) declares the operations that callers need. An [adapter](/lore/hexagonal-architecture) implements those operations for a provider. A [Layer](/lore/layers-make-dependencies-explicit) builds services and supplies their construction dependencies. Follow [add-a-store](/skills/add-a-store) for job-shaped operations and adapter Layers. Keep SQL, Drizzle, connection pools, and driver calls inside the adapter. Callers depend on the port.

A result limit bounds returned rows. EXPLAIN evidence must also prove the scanned-work budget. For tenant-scoped MySQL stores, lead the supporting index with the tenant key and preserve that filter throughout paging.

## 3. Check PlanetScale Vitess limits

These limits apply to PlanetScale Vitess transactional workloads. They do not describe PlanetScale Postgres. The [Vitess system limits page](https://planetscale.com/docs/vitess/troubleshooting/planetscale-system-limits) supplies the published values.

- **Transaction timeout**:
  - Published value: 20 s
  - Design consequence: Treat it as fixed in application configuration. Use short transactions.
- **Autocommit query timeout**:
  - Published value: 900 s
  - Design consequence: Page work well before the timeout.
- **Rows returned, updated, or deleted per query**:
  - Published value: 100k
  - Design consequence: Bound reads and bulk writes.
- **Result size per query**:
  - Published value: 64 MiB
  - Design consequence: Bound bytes as well as rows.
- **Transaction pool**:
  - Published value: Capped; capacity varies by instance type
  - Design consequence: Limit simultaneous transactions and keep them short.

The limits page says support can sometimes adjust limits per database. It offers no application setting for the transaction timeout. Do not make a design depend on a larger timeout.

Map a killed transaction to a typed adapter failure. Preserve the operation, provider code, and redacted cause. An error containing `1105` and `context deadline exceeded` needs timeout handling; `1105` alone is a generic error code. The [errors page](https://planetscale.com/docs/vitess/troubleshooting/errors) also documents `2013` deadline errors and `1105` transaction-aborted timeout errors.

Vitess pools MySQL connections through vttablet. `SHOW PROCESSLIST` shows those pool connections, rather than a one-to-one application-session list. Use application-side timing and provider query diagnostics to inspect a stalled run.

## 4. Keep Hyperdrive connections request-scoped

For the shared MySQL path, use mysql2 text-protocol `.query()` inside the adapter, as drovr does. Keep that protocol choice explicit in the query runner. Count every statement it sends.

Create the connection within the Worker request and reuse it for that request's statements. Release it through the request lifecycle. Hyperdrive owns reuse of underlying database connections across requests. Avoid a second pool or a module-global driver connection. See [Cloudflare's MySQL example](https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/) for connection lifetime details.

## 5. Make checks stronger than prose

### Count statements through the real store

Use `it.effect` and a counting executor Layer at the adapter boundary. The executor port describes statement execution; its test wrapper counts calls while delegating to the real fixture executor. Keep counters scoped to each test. Exclude fixture setup from the measured call count. This is pseudocode for a consumer-owned port, rather than a shipped rat-stack MySQL API:

```text
it.effect("scan obeys its statement budget", Effect program):
  generate N parents and bounded children
  seed the native database fixture
  provide the real store with a counting executor Layer
  reset the statement counter after setup
  scan all pages through the store port
  verify complete results, ordering, and authorization filters
  assert statements <= planned statements per page × page count
                       + planned fixed overhead
```

Generate cases below, at, and above page boundaries. Include empty pages and parents with different child counts. Vary parent count within one page: its statement count must remain constant. Include cases where the planted N+1 exceeds the budget.

Replace the batched child read with one query per parent. The count test must fail. Restore batching and run it again. Record both outcomes before trusting the check. Check rows and bytes separately; a statement-count test cannot prove index use or bounded child fan-out.

### Commit statement templates and enforce a plan fence

A fence is an enforced check that rejects prohibited work. A handler is the server-side implementation of an action. A stronger check records every statement template the native suites issue, with its source site and exercising handler. Normalize placeholder-list lengths in `IN` and multi-row `VALUES`. Never record parameter values.

```text
committed manifest entry:
  template: normalized statement text
  sites: source locations that issue it
  handlers: named handlers that exercise it
  sentBy: Worker | operator | fixture | diagnostic

executor plan fence:
  normalize each application statement
  fail when its template is absent from the manifest
  fail when its source or execution surface is disallowed
  inspect each query's plan against its index and row budget

coverage check:
  fail when a required template has no exercising handler
  compare issued templates with each handler's declared templates
```

Count `begin`, `commit`, and `rollback`. Distinguish fixture setup from application statements. Capture driver or auth pools separately if they bypass the measured executor. Report uncovered paths as test gaps. Run the same real handlers natively and through a non-production Hyperdrive connection against a PlanetScale development branch. The native plan proves local access paths. The provider run proves protocol and decoding behavior on that route.

Plant a missing manifest entry and observe the fence fail. Restore it and record the passing coverage result. A manifest proves exercised statement coverage. Add fixtures for untested branches before claiming broader coverage.

## 6. Keep consumer details in their playbooks

- **drovr:** Uses Hyperdrive text-protocol `.query()`, a committed statement-template manifest, and a plan fence. Native MySQL 8.4 CI checks exercise its real store handlers. A provider runner checks the Hyperdrive route separately.
- **front-desk:** Uses Drizzle behind store ports. Scans from an operator computer page parents and batch child reads. Its playbook owns connection setup, scan phases, and progress counters.
- **AIH support:** Uses reader-role credentials for support reads. Its playbook owns allowed columns and authorization filters.

These examples describe consumer choices. A cartridge is a package for one job, with its implementation and required infrastructure. rat-stack's current database cartridge supplies D1 and Hyperdrive Postgres adapters. A consumer supplies its MySQL executor port and counting Layer through the same store boundary.

## 7. Read the prior art

[PlanetScale database-skills](https://github.com/planetscale/database-skills) is MIT-licensed. Read its material for deeper engine guidance:

- [mysql](https://github.com/planetscale/database-skills/blob/main/skills/mysql/SKILL.md) and [vitess](https://github.com/planetscale/database-skills/blob/main/skills/vitess/SKILL.md).
- [n-plus-one](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/n-plus-one.md) and [explain-analysis](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/explain-analysis.md).
- [composite-indexes](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/composite-indexes.md) and [covering-indexes](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/covering-indexes.md).
- [query-optimization-pitfalls](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/query-optimization-pitfalls.md) and [connection-management](https://github.com/planetscale/database-skills/blob/main/skills/mysql/references/connection-management.md).

Markus Winand's [No OFFSET](https://use-the-index-luke.com/no-offset), from _Use The Index, Luke_, explains keyset pagination. Measure real limits: count store calls as well as rows. Batching can move more rows without multiplying network round trips.

## 8. Finish with evidence

Report:

- Question, caller, rate, row budget, and concurrency bound.
- Each query, its named index, and pasted EXPLAIN evidence.
- Round trips per call and run, predicted wall time, and observed timing.
- Store port, adapter, statement-count results, and planted N+1 failure.
- Manifest coverage, plan fence result, and planted missing-template failure when that stronger check exists.
- Progress behavior, typed timeout handling, and untested provider paths.

Run the consumer's native checks and provider checks. In rat-stack, finish with `pnpm turbo run check test build`.
