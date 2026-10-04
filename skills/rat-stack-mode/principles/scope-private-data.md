# Keep private data scoped at boundaries

**Applies when:** handling identities, credentials, logs, or analytics.

Carry only the data the next boundary needs. Redact credentials and remove sensitive fields before capture or publication.

**Why:** Logs and derived data can outlive the request that exposed them.

**Example:** `packages/database/src/hyperdrive-postgres.ts` wraps connection strings in `Redacted`. Request capture excludes bodies and sensitive query keys.

**Held by:** `Redacted`; `packages/events/test/capture.test.ts`; `apps/mischief/test/http-privacy.test.ts`.
