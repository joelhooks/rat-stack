---
name: model-a-protocol
description: Check a protocol with a small TLA+ model before you build or change it. Use when steps can interleave or die halfway, such as a crash between two writes, a retry after an unknown outcome, an alarm or sweep that redrives work, or two writers on one record. Also use when asked "can this race?", "what if it dies here?", or "model this", or before a durability design review.
plain: "Model the protocol in TLA+, break each guard in the model and in the code, and never count an unfinished check as a pass."
diagram: |-
  design note
    │
  spec + cfgs
    ├ safety ── exit 0, floor
    ├ liveness ── exit 0 or warn
    └ weaker ── exit 12, named
    │
  flip guard ── exit 12
  break code ── twin fails
    ▼
  review, then build
---

# Model a protocol

A protocol is a set of steps that share state, such as a request, a background delivery, a sweep and an erase on one record. Example tests run one order of those steps. A model checker runs every order within small bounds, including a crash between any two steps. It finds interleaving bugs that reading and example tests miss.

The worked example is the join-intake model in `packages/core/spec/`. Its `README.md` shows each part of this skill on real code. Its test is `packages/core/test/join-intake-spec.test.ts`.

## When to model

Model a protocol when its steps can interleave or stop halfway:

- A crash can land between two writes.
- A retry re-sends after an unknown outcome.
- An alarm, a cron sweep, or `waitUntil` finishes work the request started.
- Two writers can change one record.

Model it before the design review, so reviewers argue over a trace instead of prose. A pure fold, a read path, or a single atomic write does not need a model. Use a [property](/lore/property-based-testing) or a [model test](/lore/model-based-testing) for those.

A fix to a protocol that has no model does not wait for one. Land the fix with its failing-then-passing test.

## How to model

1. **Use the pinned checker.** `tla-ts` is exact-pinned in `packages/core/package.json` and is not vendored. The test runs its CLI as a child process, and you run the same binary by hand: `pnpm --filter @rat-stack/core exec tla-ts -config spec/<Name>.cfg spec/<Name>.tla`. Keep the spec to plain TLA+ that TLC also accepts.
2. **Make every await a step.** A crash can land between any two steps. Model the store's real atomicity. If one call writes a record and a second call writes its index, the model needs two steps for that.
3. **Write the assumptions down.** List each platform or provider behaviour the model relies on in the spec's `README.md`. Each one needs a test, or a weaker config that shows what happens without it.
4. **State each invariant in words.** Reviewers check the words against the formula. A protocol that owes work later (an alarm, a sweep) needs an invariant that the owed work stays findable, such as `OwedIsFindable`.
5. **Write the configs.** There are three kinds:
   - **safety:** `INVARIANTS`, small bounds. It must exit 0 and reach a minimum distinct-state count. A smaller count means the model stopped exploring.
   - **liveness:** `PROPERTY` only, under fairness and a finite crash budget. Every invariant also belongs to a safety config.
   - **weaker:** an environment the code does not rule out. The test expects exit 12 and the named invariant. The README records the harm and the backstop.
6. **Flip every guard.** For each invariant except `TypeOK`, replace one line of the spec so the guard is gone. Checked against only that invariant, the flipped spec must exit 12 and name it. Any other result means the flip tests nothing.
7. **Give each flip a twin.** A twin is a behaviour test that runs the real code through the same counterexample. Break the real guard once by hand, watch the twin fail, restore it, and record the date and failure in the README. The test checks that the twin's title and the code guard still exist. That check is a tie, not proof. Only a mutation proves the twin.
8. **Map actions to code.** The README's action map names the function and await behind each spec action.

## Read the exit code

The classifier in `packages/core/test/fixtures/protocol-spec.ts` covers every exit code:

| Exit | Meaning |
| --- | --- |
| 0, with a completed state count | pass |
| 10 to 14 (assumption, deadlock, invariant, liveness, assert) | counterexample |
| anything else: 150, 151, 255, a signal, the budget kill | not checked |

**Not checked is never a pass.** On a safety config it fails the test. On a liveness config it prints a `::warning::not checked: <reason>` annotation and the suite continues; a counterexample still fails. Results hold at the stated bounds. Write "checked at these bounds", never "proved".

## What the fence checks

`join-intake-spec.test.ts` fails when:

- the safety config finds a counterexample, cannot finish, or explores fewer states than its floor;
- the liveness config finds a counterexample;
- a weaker config passes, or fails on an invariant other than the named one;
- a flip's guard is not in the spec exactly once, a twin title or code guard is gone, or the flipped spec does not fail its invariant alone;
- a malformed spec or a run stopped by its budget is reported as checked.

No rule forces a model onto every protocol yet. Reviewers ask for one when a change meets the conditions in "When to model".

## What it found

On its first run, the join-intake model found three ways to lose owed work or an erase marker. The Durable Object store writes a record and its sweep index in two calls. Its `setState` reads and writes in two calls. And an erase can land inside the request's commit. Each is a weaker config with its harm and backstop in the README.

Then it checked candidate fixes. Making the erase marker sticky passed the `JoinIntakeEraseSticky.cfg` invariants for late delivery writes, and that fix shipped with a twin. It does not settle `JoinIntakeEarlyErase.cfg`: an erase inside the request's commit can prevent the ready save while the uniform answer still leaves. The early-erase and sweep-index gaps remain open in `packages/core/spec/README.md`.

The obvious fix for the index was to mark it before saving the record. The model refused it in four steps:

1. The request saves the contact as `held` and dies.
2. The eraser marks the sweep index, ahead of its save.
3. The sweep reads the record, finds no marker, and clears the index entry.
4. The eraser writes the erase marker. The work is owed, and the sweep cannot find it.

The record and the index live in two Durable Objects, and no transaction spans them, so no ordering of the two calls holds the invariant. The fix that would hold keeps an outbox beside the record: the record, an index-owed entry with a sequence number, and an alarm are written in one transaction, and the invariant becomes "owed implies indexed, or the outbox is armed". That fix is still open, and `JoinIntakeMarkBeforeSave.cfg` records why the reorder was not enough. The reorder would have passed review, and the trace stopped it before it shipped.

Read [durability](/skills/durability) for the patterns these models check, and [add a lifecycle machine](/skills/add-a-lifecycle-machine) for the machines that run them.
