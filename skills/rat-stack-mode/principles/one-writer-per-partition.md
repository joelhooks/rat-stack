# Give mutable partitions one writer

**Applies when:** updating shared mutable state.

Name the key that owns mutable state and route updates through its owner. If writers must share a target, define transactional ordering rather than relying on timing.

**Why:** Uncontrolled writers turn request order into accidental policy.

**Example:** `apps/mischief/src/interest/interest-index-durable-object.ts` owns the interest directory's persisted index through its Durable Object methods.

**Held by:** `rat-stack-patterns/no-module-level-mutable-state` blocks process-global state; review for partition ordering and atomic updates.
