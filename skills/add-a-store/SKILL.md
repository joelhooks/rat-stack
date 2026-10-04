---
name: add-a-store
description: Add persistence behind a job-shaped service with schema validation, vendor Layers, migrations, bounded reads, and shared backend tests.
---

# Add a store

Read `AGENTS.md` first. Follow its source-first rules before changing Effect or Alchemy code. Use `packages/database` as the reference, not a promise that every storage requirement is already solved.

## 1. Name the facts and their owner

- Name the stored data, its system of record, and the writer.
- Mark derived data and describe its rebuild path, freshness, and consistency.
- Read `packages/database/src/model.ts` and `packages/database/src/run-log.ts`.
- Reuse `RunLog` when its person-scoped completed-run facts and operation guarantees fit the job.
- Name genuinely different facts before adding another store. Anonymous execution starts do not fit today's `RunLog` schema.
- Keep observational reporting failures from changing unrelated capability admission or results, as request capture does in `packages/events`.
- If completeness requires gating execution, name that availability tradeoff as a product decision, not an automatic storage requirement.
- Check composition before assuming recording exists. The deployed site does not currently provide or call `RunLog`.
- For a repeated aggregate, compare a bounded query with a keyed read model. Do not scan all history per page request.
- Write the authoritative fact once. Independent writes to source and aggregate cannot guarantee consistency.

Read `skills/rat-stack-mode/principles/name-the-system-of-record.md` and `skills/rat-stack-mode/principles/no-dual-writes.md`.

## 2. Define the job-shaped port

- Copy the service shape in `packages/database/src/run-log.ts`.
- Give the port small named operations. Keep SQL, Drizzle, and vendor resources out of its callers.
- Put schemas and expected failures beside the port, as in `packages/database/src/model.ts`.
- Distinguish `InvalidDatabaseInput` from `DatabaseError`. Preserve operation and source cause.
- Define retries and operation identity explicitly. `RunLog.record` generates a fresh UUIDv7 for each call; it is not replay-idempotent.

The existing port has no atomic multi-write operation. Do not imply that two port calls share a transaction. If a source write and cursor must commit together, design that operation before building the adapter.

## 3. Validate input and decode stored rows

- Decode input before issuing storage statements, as `RunLog.record` and `RunLog.listRecent` do.
- Reject invalid input with `InvalidDatabaseInput` before storage work starts.
- Decode unknown returned rows with `PersistedRunLogRowSchema` in `packages/database/src/store.ts`.
- Decode the domain entry too. Reject mismatched outcome and failure fields instead of silently repairing them.
- Keep adapter failures typed as `DatabaseError`.

Read `skills/rat-stack-mode/principles/validate-before-durable-write.md`.

## 4. Implement each vendor and bound reads

- Read `packages/database/src/vendor.ts` and `packages/database/src/run-log-vendor.ts`.
- Keep each vendor's Drizzle operations in the cartridge. Choose one Layer with the exhaustive `DatabaseVendorResource` union.
- Name each read's key, index, ordering, row budget, and pagination rule.
- `ListRecentRunsInputSchema` bounds results to 1–100; adapters apply the person filter and `limit`.
- Inspect query plans. A bounded result can still scan many rows.
- Measure before choosing new operational limits. Label unmeasured values as guesses, not provider guarantees.

Read `skills/rat-stack-mode/principles/bound-every-read.md` and `skills/rat-stack-mode/principles/measure-real-limits.md`.

## 5. Carry schemas, migrations, and resources together

- Follow `packages/database/src/schema/d1.ts` and `packages/database/src/schema/postgres.ts`.
- Keep each dialect's migrations under `packages/database/migrations/`.
- Read `packages/database/src/migrations.ts` for paths that work outside the package directory.
- Follow `packages/database/src/d1.ts` or `packages/database/src/hyperdrive-postgres.ts` for resource-owning Layers.
- Keep connection strings redacted. Do not expose credentials through the port or failure messages.
- Follow `packages/database/src/postgres-migrations.ts` for deploy-time registration.
- Review infrastructure plans under AGENTS.md's approval rules. A schema change is not permission to delete a resource.

## 6. Prove the contract on every backend

Use `packages/database/test/run-log.test.ts` and `packages/database/test/local-layers.ts` as the executable references.

- Run the same behavior contract against D1 with local SQLite and Hyperdrive Postgres with PGlite.
- Check outcome variants, person isolation, ordering, limits, invalid inputs, and typed storage failures.
- Check replay and interrupted execution when the new operation promises idempotency or atomicity.
- Check migration paths with `packages/database/test/migration-paths.test.ts`.
- Prefer generated properties and command histories for new domain behavior. Plant a violation and observe failure before trusting them.

The current two-backend parity tests are examples, not properties. They do not prove deployed-provider behavior or vendor switching. Name those gaps when reporting. Add real-infrastructure proof when the runtime differs from these substitutes.

## 7. Compose, validate, and report

Provide the chosen Layer at the app's composition root. Expose new actions through [add-a-capability](/skills/add-a-capability). For stateful workflows, also follow [add-a-lifecycle-machine](/skills/add-a-lifecycle-machine). Run `pnpm turbo run check test build` and fix failures without weakening the fence.

Report:

- The port, operations, system of record, and derived copies.
- Vendor choice, schema changes, migrations, and resource-plan actions.
- Read bounds, query-plan evidence, and measured limits or explicit guesses.
- Validation, backend test results, replay proof, and atomicity gaps.
- Composition wiring and what remains unproven on deployed infrastructure.
