# Encode repeated lessons in structure

**Applies when:** correcting a repeated bad pattern.

Move recurring corrections into types, lint, tests, or scripts. Choose the strongest mechanism that holds, and label missing fences honestly.

**Why:** Prose depends on every future reader remembering the correction.

**Example:** `scripts/oxlint-plugin-no-comments.ts` and its fixture tests turn the no-comments rule into a failing check.

**Held by:** `no-comments/no-comments`; `packages/core/test/no-comments-rule.test.ts`; `gardener`, step 4.

**Prior art:** Adapted from pstack's `principle-encode-lessons-in-structure` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
