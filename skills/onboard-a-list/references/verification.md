# Verification properties

Test the real planner and importer. Do not test a second copy of their algorithms.

Generate tenant-scoped synthetic identities. These checks need no source account, provider write, or real email.

## 1. A deduplicated waterfall equals its union

Generate a finite base set `B`, rule actions, and matching sets with arbitrary overlaps. Include duplicate rows, matches outside `B`, empty rules, and permutations.

An eligible cut set `C_i` contains matched base identities only when its rule action is `cohort-quarantine`. Actions `retain` and `review` remove nobody.

Run the actual planner. Build the oracle through set union, independently of its ordered fold:

```text
U = union of eligible C_i
newlyRemoved_i = C_i minus union(C_0 ... C_(i-1))
remaining_i = B minus union(C_0 ... C_i)

sum(actual newlyRemoved counts) = size(U)
actual final manifest = B minus U
size(actual final manifest) + size(U) = size(B)
```

Check every intermediate count against its manifest. No count may be negative.

Duplicates and rule permutations preserve the final manifest and total cut. Per-step newly removed counts can change with rule order.

Generate the same local identifier in two tenants. A match in one tenant cannot remove the other. Include empty matches and several rules matching one identity.

Seed a double-subtraction bug. The property must fail. It must also catch independent-count addition, out-of-base cuts, review-tag exclusions, and unscoped identity comparisons.

## 2. A weak signal never creates a permanent suppression

Generate existing authoritative stops `S`, validated source-stop facts `A`, and arbitrary weak-rule matches and actions.

Include role/local-part matches, tracking absence, unknown DNS, bursts, and source-human-open recipients. Run the real importer with an in-memory destination stop service.

After import and replay with the same operation key:

```text
permanent stops = S union A
cohort quarantine and review tags remain separate facts
```

Change, reorder, or remove the weak policy. Query the stop service again. Permanent stops remain `S union A`.

A profile import, consent default, or new source identifier cannot lift a matching address stop. Include a stopped address without a profile. Then attempt a future signup with that address.

The decoder rejects `permanent-suppress` as a rule action. It also rejects `preservePermanentStops: false`.

Test the runtime writer too. Decoder rejection alone cannot prove that valid weak rules never reach a suppression writer.

Seed a weak-match-to-suppression routing bug. The property must fail. It must also catch stop replacement and lost orphan address stops.

This property does not assume a heuristic correctly identifies bots.

## Adapter and evidence acceptance

Use focused contract or fixture checks for these seams:

- Pending exports produce pending results. They never produce empty completed censuses.
- Repeated cursors, stale snapshots, and wrong tenant/source/section tokens produce typed refusals.
- Truncated exports and rejected stop rows prevent complete-stop receipts. Independent safe analysis can continue.
- Resolver failures remain unknown. Empty MX and explicit null MX remain distinct.
- Missing login/purchase/repeat-event coverage cannot produce an exact never-active count. A first-open timestamp is not a latest-open timestamp.
- Readback compares exact sets and values. Stable totals alone cannot detect membership turnover.

## Skill review cases

Use these cases for a later agent execution evaluation. A checklist review does not prove agent behavior.

- **Analyze a list with reads only**:
  - Require census, bounds, overlaps, and policy.
  - Reject live mutations.
- **Import an approved pinned plan**:
  - Reuse its authority.
  - Verify current scope and stops. Do not ask for the same approval again.
- **No login fields and only first-open history**:
  - Mark never-active unknown.
  - State first-open limits and positive-evidence alternatives.
- **Scanner clicks and legitimate aliases**:
  - Separate observations from person classification.
  - Add no permanent stops from these signals.
- **Routine broadcast to an onboarded audience**:
  - Use the project's sending procedure.
  - Do not start a migration.
- **Interrupted stop import with profile writes pending**:
  - Resume the stop job.
  - Prove required stop coverage before activating either sender.

Separate static checks, decoder execution, runtime properties, and agent execution tests in the review receipt.

This skill has no installed planner to qualify. The adopting implementation supplies behavior evidence before claiming import readiness.
