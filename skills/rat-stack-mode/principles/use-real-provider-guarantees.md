# Use real provider guarantees behind adapters

**Applies when:** choosing adapters or testing provider behavior.

Keep provider details behind a job-shaped port. Verify guarantees on the runtime that supplies them, and distinguish local substitutes from deployed proof.

**Why:** A test fake cannot prove behavior it does not model.

**Example:** `.brain/resources/lore/init-runs-twice.svx` records initialization contexts that differed; the runtime-side test catches the missing service.

**Held by:** `rat-stack-boundaries/no-core-adapters`; `apps/mischief/test/worker-runtime-init.test.ts`; review for deployed guarantees.
