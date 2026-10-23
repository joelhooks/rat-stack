# Scope waiters to the request

**Status:** placeholder. drovr writes this page and ships its fence: a `scripts/oxlint-plugin-patterns.ts` rule with a rule test.

**Applies when:** sharing an in-flight result between callers.

**Effect primitive:** a `Deferred`, `Cache`, `Ref`, or `Semaphore` created inside one request or one runtime scope, never at module level in a Worker isolate.
