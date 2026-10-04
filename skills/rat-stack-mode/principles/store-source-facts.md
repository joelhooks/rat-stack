# Store source facts and preserve uncertainty

**Applies when:** capturing observations or interpreting missing fields.

Preserve observed facts before deriving summaries. Keep missing data missing instead of inventing a value that looks measured.

**Why:** Invented defaults corrupt later analysis.

**Example:** `packages/events/src/request-geo.ts` reads supported edge metadata and omits malformed fields; `.brain/areas/analytics.svx` documents that boundary.

**Held by:** `packages/events/test/request-geo.test.ts`; `packages/events/test/request-facts.test.ts`.
