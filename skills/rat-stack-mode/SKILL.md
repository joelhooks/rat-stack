---
name: rat-stack-mode
description: Route non-trivial rat-stack code, data, design, investigation, and documentation tasks to every matching playbook and principle.
plain: "For non-trivial work, read the principles index first, then follow every playbook that matches the task."
diagram: |-
  AGENTS.md is law
    │
  read principles index
    │ open each leaf that
    │ bears on a decision
    ▼
  matching playbooks
    │
  report rules → choices
---

# Work in rat-stack mode

[AGENTS.md](/AGENTS.md) is law. [VISION.md](/VISION.md) sets the intent, reliability goals, scope, package-removal test, and shrinking debt. Use this skill to choose playbooks under those rules.

A capability is one named action with shared value definitions and a server-side implementation. A cartridge is a package for one job with its implementation and required infrastructure.

## Non-negotiables

- Start a todo list with reading the principles index below.
- Open every leaf that bears on a decision. Report which rules changed which choices.
- Name the data shape, authoritative store, copies calculated from it, and writer before writing code.
- Reuse stores when their facts and operation guarantees fit. Reporting does not justify gating unrelated execution.
- Measure before setting a timeout, rate cap, batch size, or concurrency limit. Put the baseline first; requested values remain hypotheses.

## Principles index

Leaves live in the repo; read them from a checkout.

**Product and UX**

- `skills/rat-stack-mode/principles/judge-through-the-person.md`: changing an interface or user-visible behavior.
- `skills/rat-stack-mode/principles/keep-boundary-words-honest.md`: naming failures, outcomes, and public claims.

**Architecture**

- `skills/rat-stack-mode/principles/one-contract-many-projections.md`: adding actions for agents or browser clients.
- `skills/rat-stack-mode/principles/keep-the-stack-floor.md`: choosing runtime patterns, infrastructure, and validation.
- `skills/rat-stack-mode/principles/prove-move-delete.md`: replacing an internal API or implementation.
- `skills/rat-stack-mode/principles/use-real-provider-guarantees.md`: choosing an adapter or testing its behavior.
- `skills/rat-stack-mode/principles/gates-guard-invariants.md`: adding a gate or approval check.
- `skills/rat-stack-mode/principles/keep-unknown-distinct.md`: handling crashes, refusal, or missing results.

**Data and truth**

- `skills/rat-stack-mode/principles/name-the-system-of-record.md`: adding stores, caches, aggregates, or nightly reports.
- `skills/rat-stack-mode/principles/store-source-facts.md`: capturing observations or interpreting missing fields.
- `skills/rat-stack-mode/principles/keep-execution-receipts.md`: recording runs or claiming an operation succeeded.
- `skills/rat-stack-mode/principles/scope-private-data.md`: handling identities, credentials, logs, or analytics.
- `skills/rat-stack-mode/principles/version-content-artifacts.md`: writing public content or quoting code.
- `skills/rat-stack-mode/principles/no-dual-writes.md`: copying a fact across stores or maintaining a read model.
- `skills/rat-stack-mode/principles/validate-before-durable-write.md`: recording rows, events, or snapshots.
- `skills/rat-stack-mode/principles/bound-every-read.md`: listing, querying, exporting, or rebuilding data.
- `skills/rat-stack-mode/principles/one-writer-per-partition.md`: updating shared mutable state.
- `skills/rat-stack-mode/principles/make-operations-idempotent.md`: replaying commands or recovering after crashes.
- `skills/rat-stack-mode/principles/subtract-before-you-add.md`: sequencing new work or removing unused interfaces.

**Verification**

- `skills/rat-stack-mode/principles/check-the-actual-artifact.md`: finishing work or reviewing another agent's result.
- `skills/rat-stack-mode/principles/prove-the-recipient-path.md`: changing runtime wiring or deployed interfaces.
- `skills/rat-stack-mode/principles/tests-detect-broken-behavior.md`: adding tests or judging their coverage.
- `skills/rat-stack-mode/principles/find-the-cause-first.md`: fixing failures or slow runs.
- `skills/rat-stack-mode/principles/measure-real-limits.md`: setting budgets or diagnosing contention.

**Agents**

- `skills/rat-stack-mode/principles/look-it-up-first.md`: entering unfamiliar code or deciding whether to ask.
- `skills/rat-stack-mode/principles/ask-one-material-question.md`: reaching a decision that needs owner sign-off.
- `skills/rat-stack-mode/principles/separate-writers-verify-readers.md`: dividing work or accepting delegated results.
- `skills/rat-stack-mode/principles/encode-lessons-in-structure.md`: correcting a repeated bad pattern.

**Prose and visual**

- `skills/rat-stack-mode/principles/use-plain-language.md`: writing docs, skills, or system pages.
- `skills/rat-stack-mode/principles/design-serves-function.md`: changing layout, focus, or visual emphasis.
- `skills/rat-stack-mode/principles/make-review-views-complete.md`: rendering evidence for people and agents.

**Cost and speed**

- `skills/rat-stack-mode/principles/optimise-the-whole-loop.md`: changing builds, tests, generation, or feedback time.

## Playbooks

Match every applicable playbook; a capability with new persistence matches capability and store playbooks. Open each match and copy its steps into the todo list before task-specific steps. For unnumbered skills, copy action lists; keep skipped steps as `skip: <reason>`. Finish with each matching playbook's report requirements.

- New action: [add-a-capability](/skills/add-a-capability).
- States, retries, or cancellation: [add-a-lifecycle-machine](/skills/add-a-lifecycle-machine).
- New persistence: [add-a-store](/skills/add-a-store).
- Public prose or skill pages: [write-a-wiki-page](/skills/write-a-wiki-page).
- Package or interface choices: [keep-or-cut](/skills/keep-or-cut).
- Stateful design, replacement, or read-model design: [uncomplect](/skills/uncomplect).
- Pins, recurring bad patterns, or repository maintenance: [gardener](/skills/gardener).
- Peer research or shared dependency updates: [find-peers](/skills/find-peers).
- Cloud resources or unfamiliar deployment wiring: [learn-alchemy](/skills/learn-alchemy).
- Unfamiliar stack integration: [learn-rat-stack](/skills/learn-rat-stack).

`write-a-query`, `add-a-read-model`, `explore-limits`, and `investigate-a-failure` are planned. Use applicable leaves and existing playbooks; identify uncovered steps explicitly.

## Autonomy and child-project slots

Follow AGENTS.md's **Boundaries and sign-off** for autonomy. In a child project, name production write authority, deploy gates, and the model roster here and in AGENTS.md.

Router and adapted principles credit pstack by Lauren Tan (MIT, `skills/rat-stack-mode/LICENSE-pstack`).
