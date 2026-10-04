# Validate before the durable write

**Applies when:** recording rows, events, or snapshots.

Decode input before issuing the durable write. Decode returned rows separately, and distinguish invalid input from storage failure.

**Why:** Every later reader inherits invalid durable data.

**Example:** `packages/database/src/run-log.ts` decodes record input before generating its row; `store.ts` decodes storage output.

**Held by:** `RecordRunInputSchema`; `InvalidDatabaseInput`; `packages/database/test/run-log.test.ts`; `add-a-store`, step 3.
