# The join-intake model

`JoinIntake.tla` models one agent application from the commit that answers it to a delivered or erased contact. The model covers background delivery, the five-minute intake sweep, operator erase, crashes, provider retries, and an outage of the event store (Basin). `packages/core/test/join-intake-spec.test.ts` checks it through the exact `tla-ts` pin in `packages/core/package.json`. The skill is [model a protocol](../../../skills/model-a-protocol/SKILL.md).

Results hold at these bounds only. They are checked results, not a proof.

## Run it

```sh
pnpm --filter @rat-stack/core exec vitest run test/join-intake-spec.test.ts
pnpm --filter @rat-stack/core exec tla-ts -config spec/JoinIntake.cfg spec/JoinIntake.tla
```

Measured on 2026-11-07 with `tla-ts` 0.0.8:

| Config | Kind | Result | Distinct states | Time |
| --- | --- | --- | --- | --- |
| `JoinIntake.cfg` | safety | pass | 151,783 | ~1.6 s |
| `JoinIntakeSettles.cfg` | liveness | pass | 151,783 | ~5 s |
| `JoinIntakeIndexAfterRecord.cfg` | weaker | `OwedIsFindable` violated, as expected | 19 | <1 s |
| `JoinIntakeSetStateRace.cfg` | weaker | `EraseWins` violated, as expected | 1,068 | <1 s |
| `JoinIntakeEarlyErase.cfg` | weaker | `EraseWins` violated, as expected | 93 | <1 s |

Bounds: one submission, at most one crash, one provider retry, and one Basin outage.

## Covers

- `packages/core/src/join-intake.ts`: `joinIntakeLayer`
- `packages/core/src/join-delivery-machine.ts`: `runJoinDelivery`
- `packages/core/src/intake-sweep.ts`: `IntakeSweep`
- `packages/core/src/intake-erase.ts`: `settleErase`
- `packages/core/src/join-contact-store.ts`: `withState`, `withPending`
- `apps/site/src/interest/join-contact-store.ts`: `joinContactStoreLayer`
- `apps/site/src/interest/intake-sweep.ts`: `sweepPendingIntake`

## Action map

Each await in the code is a separate step, and a crash can land between any two steps.

| Spec action | Code |
| --- | --- |
| `SaveHeld` | `joinIntakeLayer`: the first `contacts.save` with `state: "held"` |
| `RecordEvents` | `joinIntakeLayer`: `events.record(statements)` |
| `CommitRead`, `CommitWrite` | `joinIntakeLayer`: `contacts.read(statusRef)`, then the `ready` + `delivery` save |
| `Answer` | `joinIntakeLayer`: `request.afterResponse(...)`, then `return answer` |
| `SweepVisit` | `IntakeSweep.settle`; `sweepPendingIntake` clears an index entry with no marker |
| `DeliveryRead`, `DeliverySend` | `attempt` in `join-delivery-machine.ts`: `contacts.read`, then `intake.agent.submit` |
| `SettleRead`, `SettleWrite` | `contacts.setState(statusRef, deliveryStateFor[result.kind])` |
| `EraseRead`, `EraseMark` | `settleErase`: `contacts.read`, then `contacts.save(withPending(contact, "erase"))` |
| `Tombstone` | `settleErase`: `events.erase(contact.contactRef)` with bounded retry; Basin down → `pending` |
| `Remove` | `contacts.erase`; the Durable Object's `joinErase` sets the erased key and deletes the record |
| `FlushIndex` | `markPending` in `joinContactStoreLayer`, when the index write is a separate step |
| `Crash` | a request, `waitUntil`, sweep run, or operator call that dies between two awaits |
| `BasinDown`, `BasinBack` | the event store's outage starts or ends |

## Assumptions

- **The store writes atomically.** One save writes the record and its sweep-index entry together, and `setState` reads and writes in one step. `JoinContactStore.testLayer` does both. The Durable Object adapter does neither; see the weaker environments below.
- **An erase starts after the request ends.** An operator erases a submission only after its request has answered or died. Nothing enforces this. `JoinIntakeEarlyErase.cfg` checks the case where the assumption fails.
- **Erased stays erased.** A save after `Remove` is dropped. The Durable Object checks its erased key; the test store keeps an `erased` set.
- **The sweep keeps running,** and Basin comes back. These are the fairness conditions in `Spec`.
- **The provider eventually answers** `accepted` or `refused`. `MaxRetries` bounds its `retry` answers.

## Invariants

Each invariant has one guard flip that fails it alone.

- `AnswerAtCommit`: the person hears "check your email" only after the contact is committed as ready, or after it was erased.
- `SameKey`: every provider call carries the submission id that the person was answered with, so the provider can deduplicate.
- `NoSendAfterErase`: a deliverer that reads an erase marker never calls the provider.
- `TombstoneBeforeRemove`: the contact is removed only after its event tombstone lands.
- `EraseWins`: once an erase is marked, the contact stays marked until it is removed.
- `OwedIsFindable`: a contact with a delivery or erase marker is in the sweep index. This works like an armed alarm: owed work the sweep cannot find is never done.
- `TypeOK` has no flip.

`Settles` is the liveness property: an owed contact is eventually delivered, refused or removed. It is checked under weak fairness on every step except crashes, outages and starting an erase. A run that tla-ts cannot complete prints a `::warning::not checked:` annotation and does not fail the suite. A counterexample still fails it.

## Guard flips

Each flip replaces one line of the spec. Checked against only its own invariant, the flipped spec must exit 12 and name that invariant. Each flip has a twin: a behaviour test that runs the real code. On 2026-11-07, at base commit `2d139ba`, the matching code guard was broken by hand and the twin failed. The code was then restored.

| Invariant | Flip | Twin | Code broken by hand | Twin failure |
| --- | --- | --- | --- | --- |
| `AnswerAtCommit` | the answer leaves before the commit | `test/join-answer-at-commit.model.test.ts` | `join-intake.ts`: commit save moved into `afterResponse` | `expected 'held' to be 'ready'` |
| `SameKey` | a deliverer sends its own key | `test/join-answer-at-commit.model.test.ts` | `join-delivery-machine.ts`: `submissionId` suffixed with the deadline | every sent id equals the answer's: false |
| `NoSendAfterErase` | delivery ignores the erase marker | `test/intake-sweep.model.test.ts` | `join-delivery-machine.ts`: the `pending === "erase"` refusal removed | a send after the erase request |
| `TombstoneBeforeRemove` | the contact is removed before its tombstone | `test/intake-sweep.model.test.ts` | `intake-erase.ts`: `contacts.erase` before `events.erase` | the erased contact is still stored |
| `EraseWins` | a delivery result drops the erase marker | `test/intake-sweep.model.test.ts` | `join-contact-store.ts`: `withState` drops `pending === "erase"` | the erase marker gone after a step |
| `OwedIsFindable` | the store indexes only pending deliveries | `apps/site/test/join-contact-erase.test.ts` | `apps/site/.../join-contact-store.ts`: `markPending` only for `"delivery"` | `expected Set{} to deeply equal Set{ … }` |

The test checks that each flip's guard occurs once in the spec, that each twin's title is still in its file, and that each code guard is still in its source. That ties the model to the code. It does not prove the twin still fails without the guard; only another hand mutation proves that.

## Weaker environments

Each weaker config checks a case the code does not rule out. The test expects each one to fail with its named invariant.

### `JoinIntakeIndexAfterRecord.cfg`: `OwedIsFindable`

The Durable Object adapter's `save` writes the record (`joinSave`) and then the sweep index (`markPending`) in two calls. If the index call fails, the submit path catches the failure and still returns the uniform answer, and no background delivery is queued. The contact then stays `ready` with a delivery marker that the sweep never finds. The erase path has the same gap: the operator sees `pending` for an erase that the sweep never finishes.

- **Harm:** a person told "check your email" never gets the email, or an erase reported as `pending` never completes.
- **Backstop:** `rat-stack intake list` shows the contact's state, and `rat-stack intake redeliver` or `rat-stack intake erase` re-drives it by id.

### `JoinIntakeSetStateRace.cfg`: `EraseWins`

The adapter's `setState` reads the record and then writes it back in two calls. A background delivery that reads before an erase marks the contact, and writes after the mark, overwrites the erase marker.

- **Harm:** if Basin is down at that moment, the erase stays `pending` with no marker and is never finished, so the contact's data stays stored.
- **Backstop:** rerunning `rat-stack intake erase` for the id marks and erases it again.

### `JoinIntakeEarlyErase.cfg`: `EraseWins`

The request reads the contact and then commits it. An erase that marks the contact between those two calls is overwritten by the commit's delivery marker. The window is a few milliseconds of a submission's first request, and an operator has to erase an id that new.

- **Harm:** the same as above, plus a delivery the person asked to undo.
- **Backstop:** rerunning `rat-stack intake erase` for the id.

## Not modelled

- Abuse holds and the scorer-delayed answer. A delayed contact is saved as `ready` with no delivery marker; operator redelivery owns it.
- Failures of the other local store writes. The request answers uniformly on any failure (`.brain/areas/interest.svx`); only the index write is modelled as a separate step.
- The delivery machine's own retry loop. Each run makes one provider call; `SameKey` covers every call either way.
- The operator's erase and the sweep's erase running at once. The model hands a parked erase to the sweep; in code both can run `settleErase`, whose steps repeat safely.
- More than one submission. Submissions share no state except the sweep index.
