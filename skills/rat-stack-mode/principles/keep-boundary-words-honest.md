# Keep boundary words honest

**Applies when:** naming public failures, outcomes, or claims.

Describe what happened without leaking implementation details. Do not call a crash a refusal or a local test a deployed proof.

**Why:** False labels hide the action that would fix the problem.

**Example:** `packages/auth/src/current-person-middleware.ts` exposes `Unauthenticated` instead of internal session failures.

**Held by:** `Unauthenticated`; `packages/auth/test/auth.test.ts`; review for prose.

The [failure guide](/lore/error-model) shows reporting a failed operation without changing it into success.
