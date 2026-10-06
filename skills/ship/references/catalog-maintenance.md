# Keep deploy confidence honest

Phase 1 has no release-train catalog or generated confidence check.

`packages/deploy/src/capabilities.ts` owns the plan and apply contracts. `skills/ship/SKILL.md` records which procedures are available.

Update both when shipping behavior changes. Fixture tests prove local behavior only. Production qualification needs an authorized deploy and live checks.

Do not enable remote deployment, rollout, automatic restoration or flags from these reference documents. Those systems are outside phase 1.
