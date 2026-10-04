# Bound every read and inspect its access path

**Applies when:** listing, querying, exporting, or rebuilding data.

Name the key, index, row budget, and pagination rule for each read. A result LIMIT bounds output, not necessarily scanned work; inspect the query plan too.

**Why:** A small answer can still require a costly full-table scan.

**Example:** `ListRecentRunsInputSchema` limits results to 1–100; `run-log-vendor.ts` filters by person and orders by time and id.

**Held by:** `ListRecentRunsInputSchema`; `packages/database/test/run-log.test.ts`; `add-a-store`, step 4. Query-plan budgets: review.
