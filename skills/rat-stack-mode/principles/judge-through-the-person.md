# Judge through the person using it

**Applies when:** changing an interface or user-visible behavior.

Judge success through the person's task, not through implementation convenience. Exercise the interface they actually use.

**Why:** A correct handler can still produce an unusable interface.

**Example:** `apps/cli/test/cli.e2e.test.ts` exercises commands and their output rather than only invoking handlers.

**Held by:** `apps/cli/test/cli.e2e.test.ts`; review for usability.

**Prior art:** Adapted from pstack's `principle-experience-first` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
