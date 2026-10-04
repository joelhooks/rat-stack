# Name the system of record before writing code

**Applies when:** adding stores, caches, aggregates, or nightly reports.

Name one authority per fact, its writer, and each derived copy. Give read models a rebuild path and choose bounded queries or stored aggregates from measured load.

**Why:** A derived view cannot safely become a second authority.

**Example:** `apps/mischief/scripts/generate-content.ts` derives backlinks from source pages. `RunLog` stores runs; it is not wired into production.

**Held by:** `add-a-store`, step 1; `uncomplect`, Two authorities; review for read-model rebuild and freshness.
