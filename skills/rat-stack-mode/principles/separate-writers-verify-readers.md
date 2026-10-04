# Separate writers and verify delegated artifacts

**Applies when:** dividing work or accepting delegated results.

Give writers disjoint targets before work starts. Use readers for independent review, then inspect their cited artifacts rather than accepting their summaries.

**Why:** Instructions alone cannot prevent conflicting writes or prove another agent's result.

**Example:** `AGENTS.md` Source control requires preserving existing work and staging only the current task's files.

**Held by:** review; `rat-stack-patterns/no-module-level-mutable-state` covers runtime globals, not collaborative checkout ownership.

**Prior art:** Adapted from pstack's `principle-separate-before-serializing-shared-state` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
