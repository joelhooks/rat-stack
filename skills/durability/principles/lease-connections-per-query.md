# Lease a connection for the query, not the request

**Applies when:** opening a database connection, socket, or client that a handler uses more than once.

Take the connection when a query starts and give it back when the query ends. Share one lease between queries that run close together with Effect's `RcRef` and `idleTimeToLive`. Never keep a connection open while the handler waits on a provider.

**Why:** A provider call can take seconds. A connection held across it is idle but claimed, so the pool runs dry and unrelated requests wait behind a slow vendor.

**Effect primitive:** `RcRef.make({ acquire, idleTimeToLive })` with `RcRef.get` inside `Effect.scoped`. The last release starts the idle timer, and the next query inside the window reuses the lease.

**Example:** `packages/database/src/connection-lease.ts` keeps one `RcRef` per execution scope. workerd pins sockets to the request that opened them, so a lease never crosses requests. `packages/database/src/run-log-vendor.ts` runs each Hyperdrive Postgres query through it. Alchemy's `Drizzle.Postgres` keys its pool on the scope that the lease provides. `RELEASE_IDLE_POSTGRES_LEASE_AFTER` is 250 ms. drovr lists the same value as a guess with an expiry, so measure it before you trust it.

**Incident:** drovr, 2026-10-23 (car #2350, drovr-mode A7). Every PostShiba send path held a request-scoped MySQL connection across the provider call. When PostShiba slowed, `mysql.acquire` p95 rose from 0.06 s to 2.3 s while statement p95 stayed at 40 ms.

**Held by:** `packages/database/test/connection-lease.test.ts`, a model over generated requests of queries, parallel bursts, and provider waits. If you hold the connection for the whole execution, the model fails at the first wait longer than the idle lease.
