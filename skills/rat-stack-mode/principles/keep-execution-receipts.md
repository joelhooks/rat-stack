# Keep execution receipts separate from intent

**Applies when:** recording runs or claiming success.

Record the actual outcome with its source context. Do not infer execution from configuration, timestamps, or a requested action.

**Why:** Intent does not prove that the handler ran or storage accepted the result.

**Example:** `packages/database/src/model.ts` gives a run its capability, outcome, and recorded time. `store.ts` decodes the returned row.

**Held by:** `RunLogEntrySchema`; `packages/database/test/run-log.test.ts`; review for production recording, which is not wired today.
