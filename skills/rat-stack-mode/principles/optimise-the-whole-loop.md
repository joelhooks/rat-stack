# Optimise the whole feedback loop

**Applies when:** changing builds, tests, generation, or feedback time.

Measure the full loop, including waiting, cache misses, and failed reruns. Improve throughput without weakening behavioral proof or the fence.

**Why:** Fast local steps do not help when dependency ordering or contention breaks the complete run.

**Example:** PR #5 (`1cdc1c7`) adds upstream builds before content generation; serialized CI later removes sandbox contention.

**Held by:** `turbo.json` orders content generation after upstream builds; `.github/workflows/ci.yml` serializes CI tasks. Performance claims: review.
