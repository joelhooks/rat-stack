# The join-intake model

`JoinIntake.tla` models one agent application from the commit that answers it to a delivered or erased contact. The model covers background delivery, the five-minute intake sweep, operator erase, crashes, provider retries, and an outage of the event store (Basin). `packages/core/test/join-intake-spec.test.ts` checks it through the exact `tla-ts` pin in `packages/core/package.json`. The skill is [model a protocol](../../../skills/model-a-protocol/SKILL.md).

Results hold at these bounds only. They are checked results, not a proof.

Since 2026-11-15, the work-record abstraction covers the separate event-erasure marker, not the sealed contact. `TombstoneBeforeRemove` means the marker completes only after the event tombstone. The sealed payload goes earlier, on acceptance, final refusal, an unusable retry, or its 24-hour deadline. The model does not check payload retention, the metadata writes, or the alarm implementation.

The runtime histories in `test/join-delivery-machine.model.test.ts` and `test/join-erasure.model.test.ts` check settlement, retry identity, and erasure races. `apps/site/test/join-contact-retention.model.test.ts` checks stored sealed bytes, alarms, restarts, and the deadline. `apps/site/test/join-retention-backfill.test.ts` checks legacy migration and dry-run behavior. The historical weaker configs remain unchanged; their counterexamples are not claims that the new storage layout was exhaustively checked.

## Run it

```sh
pnpm --filter @rat-stack/core exec vitest run test/join-intake-spec.test.ts
pnpm --filter @rat-stack/core exec tla-ts -config spec/JoinIntake.cfg spec/JoinIntake.tla
```

Measured on 2026-11-07 with `tla-ts` 0.0.8:

| Config | Kind | Result | Distinct states | Time |
| --- | --- | --- | --- | --- |
| `JoinIntake.cfg` | safety | pass | 151,783 | ~1.6 s |
| `JoinIntakeEraseSticky.cfg` | safety | pass | 134,085 | ~1.4 s |
| `JoinIntakeSettles.cfg` | liveness | pass | 151,783 | ~5 s |
| `JoinIntakeIndexAfterRecord.cfg` | weaker | `OwedIsFindable` violated, as expected | 19 | <1 s |
| `JoinIntakeMarkBeforeSave.cfg` | weaker | `OwedIsFindable` violated, as expected | 43 | <1 s |
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
- `apps/site/src/interest/join-contact-cell.ts`: the Durable Object's `joinSave`, `joinRead` and `joinErase`
- `apps/site/src/interest/intake-sweep.ts`: `sweepPendingIntake`

## Action map

The original work-record protocol splits the following awaits into steps. A crash can land between steps. The new split metadata and payload writes are outside this abstraction.

| Spec action | Code |
| --- | --- |
| `SaveHeld` | `joinIntakeLayer`: the first `contacts.save` with `state: "held"` |
| `RecordEvents` | `joinIntakeLayer`: `events.record(statements)` |
| `CommitRead`, `CommitWrite` | `joinIntakeLayer`: `contacts.read(statusRef)`, then the `ready` + `delivery` save |
| `Answer` | `joinIntakeLayer`: `request.afterResponse(...)`, then `return answer` |
| `SweepVisit` | `IntakeSweep.settle`; `sweepPendingIntake` clears an index entry with no marker |
| `DeliveryRead`, `DeliverySend` | `attempt` in `join-delivery-machine.ts`: `contacts.read`, then `intake.agent.submit` |
| `SettleRead`, `SettleWrite` | `settle` reads the contact; accepted and refused results erase its payload, while retries save their due time with the same submission ID. The original work-record abstraction does not model these split payload writes. |
| `EraseRead`, `EraseMark` | `settleErase`: `contacts.requestErase` retains the contact reference in a separate marker |
| `Tombstone` | `settleErase`: `events.erase(marker.contactRef)` with bounded retry; Basin down → `pending` |
| `Remove` | `contacts.completeErasure` deletes only the marker after its event tombstone; sealed-contact deletion is separate |
| `FlushIndex` | `markPending` in `joinContactStoreLayer`, when the index write is a separate step |
| `PreMark` | a `markPending(true)` before `joinSave`; no code does this, see `JoinIntakeMarkBeforeSave.cfg` |
| `Refused` in `Save` | `joinContactCell`'s `joinSave`: the erased key, and with `EraseSticky` a stored erase marker |
| `Crash` | a request, `waitUntil`, sweep run, or operator call that dies between two awaits |
| `BasinDown`, `BasinBack` | the event store's outage starts or ends |

## Assumptions

- **The store writes atomically.** One save writes the record and its sweep-index entry together, and `setState` reads and writes in one step. `JoinContactStore.testLayer` does both. The Durable Object adapter does neither. `JoinIntakeEraseSticky.cfg` checks the adapter's split `setState` against its sticky erase guard; the split index write is still open, see the weaker environments below.
- **An erase starts after the request ends.** An operator erases a submission only after its request has answered or died. Nothing enforces this. `JoinIntakeEarlyErase.cfg` checks the case where the assumption fails.
- **Erased stays erased.** A save after `Remove` is dropped. The Durable Object checks its erased key; the test store keeps an `erased` set.
- **The sweep keeps running,** and Basin comes back. These are the fairness conditions in `Spec`.
- **The provider eventually answers** `accepted` or `refused`. `MaxRetries` bounds its `retry` answers.

## Invariants

Each invariant has one guard flip that fails it alone.

- `AnswerAtCommit`: the person hears "check your email" only after the contact is committed as ready, or after it was erased.
- `SameKey`: every provider call carries the submission id that the person was answered with, so the provider can deduplicate.
- `NoSendAfterErase`: a deliverer that reads an erase marker never calls the provider.
- `TombstoneBeforeRemove`: the erase marker completes only after its event tombstone lands.
- `EraseWins`: once an erase is marked, its work record stays marked until completion.
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
| `EraseWins`, in `JoinIntakeEraseSticky.cfg` | a late delivery result overwrites the erase marker | `apps/site/test/join-contact-cell.test.ts` | `join-contact-cell.ts`: the stored-marker refusal disabled; separately, `join-contact-store.ts`: `false` passed for `erase` | `expected undefined to be 'erase'`, both times |

The sticky-erase row was mutated on 2026-11-07 at commit `1cf8040`. Disabling the refusal also fails the cell's property, `expected 'sealed-1' to be 'sealed-0'`.

The table above records historical mutations of the combined contact-and-marker implementation. The current source tie for `TombstoneBeforeRemove` points to `contacts.completeErasure`, not `contacts.erase`. The runtime erase-history test checks that deleting sealed data leaves the marker intact.

| Tie | Before | Now |
| --- | --- | --- |
| `TombstoneBeforeRemove` | `Effect.retry(RETRY_ERASE_TOMBSTONE)` then `contacts.erase(submissionId)` | Event tombstone succeeds, then `contacts.completeErasure(submissionId)`; `contacts.erase` deletes only the sealed payload |

On 2026-11-15, skipping sealed-contact erasure for `accepted` failed the delivery model with a single accepted result at time zero. Replay: `[0,"-8489209264382513",5,0,[0,0,0],"PropertyError"]`. Making `joinErase` also delete the separate marker failed the durable-cell history with one `requestErase` command at time zero. Replay: `[0,"-5426859627743535",1,0,[0],"PropertyError"]`. Both mutations were restored before validation.

Removing the durable pre-dispatch handoff write also failed both erase-history properties on 2026-11-15. The first shrank to dispatch, accepted, then erase; replay `[0,"-3152302148389143",0,0,[0,0],"PropertyError"]`. The write-failure property also caught dispatch escaping after its durable write failed; replay `[0,"-2340553278854977",0,0,[0,0],"PropertyError"]`. The guard was restored before the full gate.

The two retention mutations requested for this slice were also planted on 2026-11-15. Disabling deadline expiry left a sealed contact physically present at the deadline and failed the durable-cell model; replay `[0,"4865270492316789",1,0,[0],"PropertyError"]`. Changing the submission ID only on a retry failed the delivery model with timeout followed by challenge; replay `[0,"3741748008396045",51,3,[0,0,0,0,0,0,0,2,2,3,2,2],"PropertyError"]`. Both mutations were restored before validation.

The second review's sweep-hold mutation was compiled and tested: removing only `IntakeSweep`'s hold guard failed the isolation model with one delivery-actor entry instead of zero; replay `[0,"6614641173065529",0,0,[0],"PropertyError"]`. The machine's separate hold guard still prevented the HTTP call. The model observes the earlier dispatch boundary and compares the other rows' deliveries, erasures, index cleanup and listing against a run without the unreadable row. The guard was restored before validation. A later full run exposed an outdated recovery assumption in the sweep model: a reply can park a future retry just before its delivery fiber is killed. Recovery now advances to that persisted due time before requiring another dispatch; replay `[0,"8014738335715117",88,4,[7,6,3,1,1,1],"PropertyError"]`.

Two paging mutations also failed the generated tests: including the previous cursor's ID again returned `synthetic-000` instead of `synthetic-001`, replay `[0,"-72462705547771",0,0,[1,0,0,0,1,1,0],"PropertyError"]`; dropping the page's `current` count from the script's sum returned zero instead of one, replay `[0,"6557043426597053",6,1,[1,1,1],"PropertyError"]`. Both were restored before validation.

`apps/site/test/join-contact-runtime.test.ts` saves deliberately unreadable bytes through the real `Interest` Durable Object in workerd. It verifies a native alarm is armed, then observes SQLite directly without another contact read. Expiry deletes the payload, leaves intake statements intact, and creates no subject-erasure marker. A subject-erasure marker explicitly created before expiry survives it. This checks the actual Alchemy handler wiring and storage alarm, not a memory stub or read-time expiry.

The test checks that each flip's guard occurs once in the spec, that each twin's title is still in its file, and that each code guard is still in its source. That ties the model to the code. It does not prove the twin still fails without the guard; only another hand mutation proves that.

## Weaker environments

Each weaker config checks a case the code does not rule out. The test expects each one to fail with its named invariant.

### `JoinIntakeIndexAfterRecord.cfg`: `OwedIsFindable`

The Durable Object adapter's `save` writes the record (`joinSave`) and then the sweep index (`markPending`) in two calls. If the index call fails, the submit path catches the failure and still returns the uniform answer, and no background delivery is queued. The contact then stays `ready` with a delivery marker that the sweep never finds. The erase path has the same gap: the operator sees `pending` for an erase that the sweep never finishes.

- **Harm:** a person told "check your email" never gets the email, or an erase reported as `pending` never completes.
- **Backstop:** `rat-stack intake list` shows the contact's state, and `rat-stack intake redeliver` or `rat-stack intake erase` re-drives it by id.
- **Open:** [join intake index outbox](../../../.brain/projects/join-intake-index-outbox.svx).

### `JoinIntakeMarkBeforeSave.cfg`: `OwedIsFindable`

The obvious fix for the gap above is to call `markPending(true)` before `joinSave`. The model refuses it in four steps:

1. The request saves the contact as `held` and dies.
2. The eraser marks the sweep index, ahead of its save.
3. The sweep reads the record, finds no marker, and clears the index entry.
4. The eraser writes the erase marker. The work is owed, and the sweep cannot find it.

`sweepPendingIntake` does exactly step 3: it reads the contact, then calls `markPending(false)`. Marking again after the save still loses to a crash between the save and the second mark. The record and the index live in two Durable Objects, and no transaction spans them, so no ordering of the two calls keeps `OwedIsFindable` true at every step. The fix that holds keeps an outbox beside the record; the card above has its shape.

- **Harm and backstop:** as above.

### `JoinIntakeSetStateRace.cfg`: `EraseWins`

The adapter's `setState` reads the record and then writes it back in two calls. A background delivery that reads before an erase marks the contact, and writes after the mark, would overwrite the erase marker.

The Durable Object now refuses that write. `joinSave` takes an `erase` flag, stores it in the same value as the sealed contact, and drops any save without the flag once a stored contact carries it. `JoinIntakeEraseSticky.cfg` checks the same split `setState` with that guard and passes every invariant. This config keeps the environment without the guard, so the test shows what the guard prevents.

- **Harm without the guard:** if Basin is down at that moment, the erase stays `pending` with no marker and is never finished, so the contact's data stays stored.
- **Backstop:** rerunning `rat-stack intake erase` for the id marks and erases it again.

### `JoinIntakeEarlyErase.cfg`: `EraseWins`

The request reads the contact and then commits it. An erase that marks the contact between those two calls is overwritten by the commit's delivery marker. The window is a few milliseconds of a submission's first request, and an operator has to erase an id that new.

With the sticky erase guard, the Durable Object refuses the commit instead, and `EraseWins` holds. `AnswerAtCommit` then fails, because the request answers after a commit that never landed. The memory store has no guard.

- **Harm:** the same as above, plus a delivery the person asked to undo.
- **Backstop:** rerunning `rat-stack intake erase` for the id.
- **Open:** [join intake early erase](../../../.brain/projects/join-intake-early-erase.svx).

## Operator migration and erasure

`joinRetentionBackfill` is an operator capability at `POST /operator/interest/applications/retention-backfill`, protected like `intakeErase`. An empty JSON body runs an informational dry-run. Only `{"apply": true}` applies that operator request. This is not a migration consent gate: normal reads, operator application listings, erasure requests and the five-minute sweep already migrate readable legacy records on first access. Counts can therefore describe post-migration state. Preview is not read-only: reading a past-deadline row deletes its expired sealed payload. Required after deployment: run authenticated `{"apply":true}`, then repeat the preview until `finished` and `erase` are both zero. Unreadable rows remain a separate owner decision.

Each request processes a sorted page of application IDs. `after` resumes after the preceding `nextCursor`; `null` means the pass is complete. `limit` defaults to 25 and is capped at 50, with concurrency four. Migration uses roughly 8–11 Durable Object RPCs per applied legacy row, depending on its state. A maximum page therefore budgets roughly 400–550 RPCs plus the index read and request overhead, below the deployment's 1,000-subrequest allowance. Smaller allowances need a lower `limit`.

A request can still time out or hit a platform cap. Retry its last `after` cursor; migration is idempotent, and the cursor avoids spending later requests on a completed prefix. The index reader still enumerates all IDs in one RPC before choosing the page; a paged index reader remains follow-up work. The composition must supply `applicationIds`; the type requires it and no empty-list fallback masks missing wiring.

### Walk every page

Use `pnpm --filter @rat-stack/site retention:backfill <origin>` for a complete preview pass. Supply the existing `INTEREST_OPERATOR_TOKEN` through the approved secret environment, not a command argument. The script reads it with Effect Config, refuses unsafe origins and redirects, walks every cursor page and prints only complete summed counts. A failed page, invalid response or non-advancing cursor exits non-zero without successful totals or a credential in its error.

After reviewing the preview, run `pnpm --filter @rat-stack/site retention:backfill <origin> --apply`. Then run the preview command again and require the complete `finished` and `erase` totals to be zero. Investigate unreadable rows separately. Restarting an interrupted pass is safe; the individual requests remain bounded. The in-process page walk is an XState machine, and its HTTP adapter is tested against a fake fetch server for summing, cursor progression and failure handling.

The backfill erases finished and legacy held contacts, converts legacy erasures to separate markers, and gives pending ready contacts one 24-hour window. Legacy held contacts and legacy ready contacts with `hold:true` never become dispatchable. The sweep independently refuses held delivery work before starting a delivery actor; the delivery machine retains its own hold guard. Newly held contacts are deliberately erased at intake; there is no release path. The intake's `statusRef` is the `submissionId` used as the store key. A missing intake agent is a configuration outage, not a refusal: it leaves a contact pending until recovery or its original deadline.

No migration path deletes a row because decryption failed, including explicit apply. Unreadable legacy rows keep their bytes, index entry and any existing deadline for operator key recovery. Implicit reads fail with the typed `JoinContactUnreadable`, never a defect or a silently missing contact. Both sweep phases isolate errors per ID and leave the damaged row pending. The operator listing returns an `unreadable` row alongside its readable rows rather than failing the entire list. Backfill counts unreadable rows without changing them. A legacy unreadable row without a deadline is the one exception to the 24-hour bound, pending the owner's decision after real production counts. A later, separate explicit erase capability may handle those rows. A readable sentinel is not permission to destroy ciphertext encrypted under an older key.

The cell's deadline is authoritative, not the encrypted plaintext's optional copy. The adapter reads it from the cell before classifying a contact; an absent or extended plaintext value cannot turn a fresh row into legacy work or invent a handoff. No save extends the cell deadline. If the deadline disappears between RPCs, the adapter rechecks the sealed snapshot before treating it as legacy; a concurrent alarm must not invent a historical handoff. The generated interleaving failed before that guard with replay `[0,"-8875396261079519",1,0,[0,1],"PropertyError"]`.

Expiry is payload retention, not a subject-erasure request. The native alarm and read-time expiry delete sealed bytes without decrypting, leave event history intact, and never create or clear a subject-erasure marker. Explicit subject-erasure requests still retain their separate marker until their event tombstone succeeds. Payload expiry creates no event-erasure work to orphan, so the alarm needs no sweep-index write. Only join contacts schedule alarms on the `Interest` class; address records and intake-vault methods never set one. There is no competing alarm consumer to route today. Storage outages fail the affected operation rather than being classified as unreadable data.

`legacyHandoffTimeUnknown` counts legacy contacts, unreadable rows and missing rows without handoff metadata which may have reached drovr without a known first dispatch time. It overlaps the state-group counts. Unknown historical handoffs are forwarded conservatively, including erasure results for missing history or failed reads. Absence of history is not proof of no handoff. The nine-row fixture reports current 1, finished 4, erase 1, pending 1, unreadable 1, gone 1, and unknown handoff time 8. After applying, it reports current 2, gone 6, unreadable 1 and unknown time 8.

The erase result's `handedToDrovr` means: **a delivery attempt left for drovr, so drovr may hold this contact; forward the erasure**. It is a conservative dispatch-intent flag, persisted before the request leaves. A failed flag write prevents dispatch. Neither a timeout, a crash nor a final refusal clears it. It does not prove admission or email delivery.

`handedToDrovrSubmissions` returns each affected `submissionId` with `handedAt`, the immutable first dispatch-intent ISO time. Legacy time is explicitly `null`, never a made-up backfill time. Send the tenant and the address by encrypted operator message: `erasure request, handed to drovr at <time>`. For a null time, say `handed to drovr before <slice 1 deploy date>, exact time unknown`. Keep the deploy date in the operator's receipt, not in the contact's timestamp.

This slice completes the local erase marker after the event tombstone. The random reference, handoff flag and first dispatch time remain available for repeated operator erasure requests. `join-contact-meta` has no expiry; this indefinite minimal metadata retention must be disclosed on the slice 4 page. It does not record drovr's final `stopped` or `not held` answer. Remote completion tracking and the reviewed public subscribers page remain later work; no automatic forwarding is implemented here. The prior main and this slice have no `geo` field in the agent adapter, intake, join contract or contact schema, so the whitelist drops no geography data. Slice 2 adds the vendored geography schema; this slice does not claim that whitelist is the full wire contract.

## Not modelled

- Abuse holds and the scorer-delayed answer. A delayed contact is saved as `ready` with no delivery marker; operator redelivery owns it.
- Failures of the other local store writes. The request answers uniformly on any failure (`.brain/areas/interest.svx`); only the index write is modelled as a separate step.
- The delivery machine's own retry loop. Each run makes one provider call; `SameKey` covers every call either way.
- The operator's erase and the sweep's erase running at once. The model hands a parked erase to the sweep; in code both can run `settleErase`, whose steps repeat safely.
- More than one submission. Submissions share no state except the sweep index.
