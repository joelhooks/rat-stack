# Write each fact once

**Applies when:** copying facts across stores or maintaining a read model.

Write the authoritative fact once. Derive other copies from committed data with replay and rebuild, not two independent request writes.

**Why:** Partial failure can leave independently written copies inconsistent.

**Example:** `packages/database/src/run-log-vendor.ts` exhaustively selects one backend; it does not insert each run into both vendors.

**Held by:** `DatabaseVendorResource` and `Match.exhaustive` select one vendor; `add-a-store`, step 1; review for cross-store duplication.
