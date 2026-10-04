# Prove the path the recipient uses

**Applies when:** changing runtime wiring or deployed interfaces.

Exercise the actual surface and execution context. Include missing credentials, production bundles, or isolate startup when that is the recipient's path.

**Why:** A successful development path can hide a broken deployed path.

**Example:** `apps/mischief/test/worker-runtime-init.test.ts` checks runtime startup without deploy-only services; PR history records the earlier failure.

**Held by:** `apps/mischief/test/worker-runtime-init.test.ts`; `apps/web/test/production-bundle.test.ts`.
