# Prove the replacement, move callers, delete the old path

**Applies when:** replacing an internal API or implementation.

Prove preserved behavior, inventory callers, move them, and delete the replaced path. Retain rollback resources only under the approval rules in AGENTS.md.

**Why:** Parallel internal paths make future fixes ambiguous.

**Example:** `skills/keep-or-cut/SKILL.md` removes a projection together with its exports, composition, command, and matching tests.

**Held by:** `keep-or-cut`, Clean up after each cut; `uncomplect`, Run the cartridge test.

**Prior art:** Adapted from pstack's `principle-migrate-callers-then-delete-legacy-apis` by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
