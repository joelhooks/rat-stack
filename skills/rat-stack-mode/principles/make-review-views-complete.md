# Make review views preserve the evidence

**Applies when:** rendering evidence for people and agents.

Give each view enough source context to verify its claims. Render shared facts rather than maintaining separate human and agent copies.

**Why:** A review view without provenance makes readers reconstruct the evidence by hand.

**Example:** `apps/mischief/scripts/component-registry.ts` renders code snippets for HTML and Markdown from one snippet model.

**Held by:** `apps/mischief/test/code-pipeline.test.ts`; `packages/code-snippets/test/pipeline.test.ts`; review for review completeness.
