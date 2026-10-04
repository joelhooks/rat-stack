# Find the cause before choosing the fix

**Applies when:** fixing failures or slow runs.

Reproduce the symptom and distinguish cause from correlation. Test the causal hypothesis before changing broad settings or converting errors into outcomes.

**Why:** A larger timeout can hide contention without removing it.

**Example:** PR #6 raises test budgets. PR #8 keeps those budgets and serializes tasks; its Docker run reports 58/58 in 154 seconds.

**Held by:** review; planned: `investigate-a-failure`.

**Prior art:** Adapted from pstack's `principle-fix-root-causes` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
