# Subtract before adding new machinery

**Applies when:** sequencing an addition, refactor, or rewrite.

Remove unused structure before building on it. Keep necessary behavior and boundary validation; do not delete them merely to shrink a diff.

**Why:** A smaller base needs fewer compatibility paths and fewer explanations.

**Example:** `skills/keep-or-cut/SKILL.md` traces retained imports before removing unused projections and composition.

**Held by:** `keep-or-cut`, Clean up after each cut; `uncomplect`, Deepen the seam.

**Prior art:** Adapted from pstack's `principle-subtract-before-you-add` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
