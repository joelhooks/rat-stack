---
name: add-a-feature-flag
description: Declare a typed feature flag, its scoped evidence ladder, approval roles, removal date, and durable ledger adapter.
plain: "Declare each rung and its exit measurement. Climb with scoped evidence and approval. Record every attempt before the gate."
diagram: |-
  ladder + scope
    │
  evidence → Pending
    │
  approval → DO commit
    │        value + receipt
    │        dirty marker
    ▼
  alarm → KV → reader
---

# Add a feature flag

A read scope is the partition for a flag value and its evidence.

A flag selects behavior through a declared ladder. Each climb needs evidence from the current rung and its exact read scope.

Read [Flags climb on evidence](/lore/flags-climb-on-evidence) and [Feature flags](/systems/flags) first.

## 1. Decide whether a flag fits

Use deployment Config for kill switches and safety stops. KV is eventually consistent. Another location can retain an old value for 60 seconds or more.

`off` records a stop without waiting for approval. It does not make KV propagation immediate. A stop that must affect every request immediately needs a stronger control path.

`EVENTS_ENABLED` stays deployment Config because it selects cloud resources. Change its Config value and review the infrastructure plan.

## 2. Declare the ladder

Use `defineFlag` in core or the child's declaration module.

Declare:

- A stable name and JSON-encoded [value schema](/lore/schemas-define-the-boundary).
- The safe `default`, `owner`, `purpose`, and literal `removeBy` date.
- A nonempty `rungs` tuple. Put the default value first.
- A unique name and value for each rung.
- An `authority`: `agent`, `arbiter`, or `owner`.
- An evidence exit for every non-final rung. End with one final rung.
- A child-supplied `readScope` schema. Omission means the literal `global` scope.
- A `kill` policy: default rung, previous rung, or an explicit refusal reason.
- A `failurePolicy`. The default is `use-catalog-default`; use `refuse` when a fallback would be unsafe.

Use `FlagExit`, `FlagThreshold`, `FlagKill`, and `FlagTarget` constructors from `@rat-stack/core/flag-control`.

The declaration rejects duplicate rung names or values. It also rejects a misplaced final exit or a first value different from the default.

## 3. Name each exit's evidence

For every exit measurement, name:

1. The measured `event`.
2. Its `read` location, such as an acceptance report or a named query.
3. Its threshold: `at-least` or `at-most`, with a finite count.
4. The read scope where that measurement applies.

Record the measured value and a source `ref` through `record_flag_evidence`. The event, read location, and current rung must match the declaration. A newer observation replaces that event's current measurement. The attempt ledger retains submitted observations. A flip clears current evidence. An old measurement cannot qualify a later visit to that rung.

A schema mismatch returns `FlagScopeMismatch` with a `repair` field. Readers, evidence writers, and flips enforce the same schema. Evidence from one scope never qualifies another scope.

## 4. Compose authority and storage

Mount `flip_feature_flag`, `record_flag_evidence`, and `read_flag_ledger` only on the child's [operator surface](/lore/one-schema-three-surfaces). Public readers and the sandbox remain read-only.

Authenticate operator requests in the child's composition before dispatch. Keep token authentication outside `Approval`, because `off` bypasses approval.

Provide the [capability](/systems/capabilities) `Approval` [service](/lore/services-capture-dependencies) at composition. It authorizes the requested role, target, scope, and quoted `approvalRef`. A role field or token name does not grant authority. Climbs above agent need a nonempty approval quote as well as approval.

`flip_feature_flag` calls `implement`'s approval gate for climbs. For `off`, its audited [handler](/systems/capabilities) supplies an always-granted approval implementation. Test this path with a service that denies every other call.

Use `cloudflareFlagControlLayer()` from `@rat-stack/flags/cloudflare` for the default ledger. For a child catalog, pass the definition returned by `defineFlagLedger(registry, deployOnly)`. Each flag and scope routes to its own Durable Object. The normal `cloudflareFlagsLayer` reads KV and never calls a Durable Object.

A projection is a copy derived from a committed value.

The DO commits the authoritative value, receipt, and dirty projection marker in one storage transaction. An alarm projects committed values to KV. Failed projections retain their markers. Cloudflare retries a failed alarm six times, starting with two seconds of backoff. After the final failed retry, the [adapter](/lore/hexagonal-architecture) schedules a fresh window at the next exponential backoff step. The operator can also call the internal `redrive` method after recovery. A successful flip means committed, not globally visible.

`kvFlagControlLayer(registry, kv)` refuses authoritative flips and evidence writes with `FlagAtomicityRequired` by default. Reads and attempt journals remain available. A composition can accept the weaker guarantee with the typed option `{ authoritativeWrites: "accept-non-atomic-unserialized" }`. Pass it as the third argument. This permits non-atomic writes without cross-isolate serialization; it does not make them safe for competing writers. The memory adapter supplies the same domain behavior for tests.

## 5. Prove and remove

1. Run generated flip and evidence histories across scopes.
2. Prove no climb without local evidence, no elevated climb without approval, down only through `off`, and every attempt recorded.
3. Plant one violation of each rule. Record the failing property and replay information. Restore the code.
4. Crash after commit and before projection. Recreate the ledger, redrive, and prove the replica converges.
5. Check readers during that gap. They may see an older value or the declared default.
6. Keep the lifecycle model green.
7. Run `pnpm turbo run check test build`.
8. Remove the flag and its call sites by `removeBy`, or make its final behavior permanent.

Report the flag's purpose, owner, removal date, scopes, exits, approval boundary, selected adapter, and proof. Name provider behavior that local tests do not establish.
