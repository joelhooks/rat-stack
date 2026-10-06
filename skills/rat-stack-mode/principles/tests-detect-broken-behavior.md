# Make tests detect broken behavior

**Applies when:** adding tests or judging coverage.

Name the behavior gap before adding a test. Prefer properties and generated histories; plant a violation and observe failure before trusting a new property.

**Why:** A change detector or tautology gives confidence without testing the contract.

**Example:** `packages/core/test/inspect-machine.model.test.ts` checks generated lifecycle histories against an independent model.

**Held by:** `add-a-lifecycle-machine`, step 5; `gardener`, step 4; review for mutation evidence.

Use [tests through supplied services](/lore/tests-that-earn-their-place) to choose a seam test, property, or generated history.
