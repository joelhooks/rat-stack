# Measure limits on the real workload

**Applies when:** setting budgets or diagnosing contention.

Plan measurement before budget edits; a requested constant is a hypothesis until the measured workload supports it. Keep guesses explicit and distinguish provider limits from local contention.

**Why:** A guessed limit can reject healthy work or leave overloaded work running longer.

**Example:** `.github/workflows/ci.yml` uses `--concurrency=1` after sandbox contention; PRs #6 and #8 show budget changes alone were insufficient.

**Held by:** `rat-stack-mode`, Non-negotiables; `add-a-store`, step 4; review for measurements; planned: `explore-limits`.
