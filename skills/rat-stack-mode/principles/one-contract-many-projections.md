# Define one contract and project every surface

**Applies when:** adding an action for agents or browser clients.

Define schemas, failures, and metadata once. Project the capability into typed agent surfaces and browser RPC instead of adding separate handlers.

**Why:** Multiple descriptions drift while people and agents still need the same behavior.

**Example:** `packages/core/src/contracts.ts` defines `inspectFileContract`; `apps/cli/src/surfaces.ts` projects its implementation.

**Held by:** `rat-stack-boundaries/no-hand-rolled-surface`; `rat-stack-patterns/contract-binding-matches-name`; `add-a-capability`, step 4.
