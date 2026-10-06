# Keep crashes distinct from expected outcomes

**Applies when:** handling crashes, refusal, or missing results.

Represent expected outcomes with typed variants. Propagate unexpected execution failure instead of recording a successful terminal decision.

**Why:** Recovery needs to know whether work was refused or never completed.

**Example:** PR #9 (`37b8ba9`) removes the delivery machine's crash-to-settled transition, which had stored permanent refusal.

**Held by:** `packages/core/test/join-delivery-machine.model.test.ts`; `packages/core/test/join-interest.test.ts`.

Read [expected failures and defects](/lore/error-model) before choosing a recovery boundary.
