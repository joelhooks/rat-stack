# Contracts and policy

The boundary serves one job: capture a list's migration facts with enough provenance to reproduce a selection. It does not subscribe people or send mail. Provider SDKs, export formats, and provider terminology stay inside adapters.

## Job-shaped source port

`ReadListSnapshot.capturePage` accepts a tenant/source scope, stable capture-job key, requested snapshot, section, and opaque resume cursor. It returns a decoded page or a pending export job. A source adapter never reports a pending export as an empty completed page.

Each page carries:

- Contact, preference, address-stop, activity, or automation facts in owned domain Schemas.
- The scope, capture-job key, source reference, section, and observation interval.
- Snapshot consistency: source snapshot or live paginated walk.
- A next cursor or explicit terminal receipt; expected and observed totals where available.
- Event coverage and timestamp meaning: first, latest, or individual event.
- Whether human classification is available.

Bind every resume token to its scope, source, snapshot, and section. Detect repeated cursors and unexpected source changes. A stable before/after count helps reconciliation. It does not prove membership stayed unchanged. Retain the captured page digests and record that limitation.

Use a `Context.Service` at the owning application boundary. Its Effect error channel distinguishes source unavailable, invalid source facts, and changed capture identity. Return a typed reason and the next valid call.

The adapter owns transport retry. The persisted job owns export waiting and resume. Do not stack independent retry loops. Hold no database resources across provider calls.

Do not add this job to a runtime mailing-list membership interface. The planner needs normalized migration facts, not provider CRUD. Define concrete fact Schemas in the owning domain before wiring an adapter. Do not substitute an arbitrary provider-payload object.

## Policy and census Schemas

This Effect 4.0.0 sketch defines policy data and census output. It does not implement an importer. Verify APIs against the adopting project's exact pin. Use the same decoded policy for dry-run and apply planning.

All policy rules select or annotate a cohort. None can create a permanent suppression. Only independently captured authoritative stop facts can enter the destination's add-only stop writer. A policy cannot declare its own evidence authoritative. The server loads verified source-stop receipts through a separate typed input.

```ts
import { type Effect, Schema } from "effect";

const Text = Schema.NonEmptyString;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegative = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0)
);
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));

export const Scope = Schema.Struct({
  tenantId: Text,
  sourceId: Text,
});

export const Quantity = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("exact"), value: Count }),
  Schema.Struct({
    kind: Schema.Literal("upper-bound"),
    value: Count,
    missingEvidence: Text,
  }),
  Schema.Struct({
    kind: Schema.Literal("lower-bound"),
    value: Count,
    missingEvidence: Text,
  }),
  Schema.Struct({ kind: Schema.Literal("unknown"), missingEvidence: Text }),
]);

export const SourcePin = Schema.Struct({
  reference: Text,
  revision: Text,
  observedAtEpochSeconds: Count,
  artifactSha256: Digest,
});

const Parameters = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("domain-set"),
    domains: Schema.Array(Text),
    includeParentDomainSuffixes: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("local-part-set"),
    localParts: Schema.Array(Text),
    classifyBeforePlusTag: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("dns-state"),
    states: Schema.Array(Schema.Literals(["nxdomain", "null-mx"])),
    requireFreshEvidenceAtApply: Schema.Literal(true),
  }),
  Schema.Struct({
    kind: Schema.Literal("no-observed-activity"),
    requiredEvidenceKinds: Schema.Array(Text),
    positiveEvidenceVetoes: Schema.Array(Text),
    incompleteHistoryResult: Schema.Literal("unknown"),
  }),
  Schema.Struct({
    kind: Schema.Literal("created-time-burst"),
    bucketSeconds: Schema.Literals([60, 3600]),
    minimumPeople: PositiveInt,
    timestampMeaning: Text,
  }),
  Schema.Struct({
    kind: Schema.Literal("digit-run"),
    minimumConsecutiveDigits: PositiveInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("local-part-entropy"),
    minimumLength: PositiveInt,
    minimumLetters: Count,
    minimumDigits: Count,
    minimumBitsPerCharacter: NonNegative,
    alphabet: Schema.Literal("lowercase-ascii-alphanumeric"),
  }),
  Schema.Struct({
    kind: Schema.Literal("fast-event"),
    metric: Schema.Literals([
      "raw-open",
      "raw-click",
      "human-open",
      "human-click",
    ]),
    windowDays: PositiveInt,
    maximumLagSeconds: NonNegative,
    match: Schema.Literals(["any-event", "all-qualifying-first-events"]),
    timestampMeaning: Text,
  }),
  Schema.Struct({
    kind: Schema.Literal("human-engagement"),
    metric: Schema.Literals(["human-open", "human-click"]),
    windowDays: PositiveInt,
    timestampMeaning: Schema.Literals(["first", "latest", "event"]),
  }),
]);

export const CutRule = Schema.Struct({
  ruleId: Text,
  evidence: SourcePin,
  parameters: Parameters,
  action: Schema.Literals(["retain", "review", "cohort-quarantine"]),
});

export const ListImportPolicy = Schema.Struct({
  version: Schema.Literal(1),
  scope: Scope,
  baseManifestRef: Text,
  sourceSnapshotRef: Text,
  rules: Schema.Array(CutRule),
  preservePermanentStops: Schema.Literal(true),
  normalization: Schema.Struct({
    domain: Schema.Literal("idna-lowercase"),
    rewriteTypoAddresses: Schema.Literal(false),
    collapsePlusTagsInIdentity: Schema.Literal(false),
    collapseDotsInIdentity: Schema.Literal(false),
  }),
});

export const ListCensus = Schema.Struct({
  scope: Scope,
  sourceSnapshotRef: Text,
  captureReceipts: Schema.Array(SourcePin),
  sections: Schema.Array(
    Schema.Struct({
      name: Text,
      population: Text,
      quantity: Quantity,
      evidenceRef: Text,
    })
  ),
});

export const SnapshotPageRequest = Schema.Struct({
  scope: Scope,
  jobKey: Text,
  snapshotRef: Text,
  section: Schema.Literals([
    "contacts",
    "preferences",
    "stops",
    "activity",
    "automations",
  ]),
  resumeCursor: Schema.NullOr(Text),
});

export const CaptureReceipt = Schema.Struct({
  request: SnapshotPageRequest,
  observedFromEpochSeconds: Count,
  observedThroughEpochSeconds: Count,
  consistency: Schema.Literals(["source-snapshot", "live-walk"]),
  artifactSha256: Digest,
  expectedSectionTotal: Quantity,
});

export class SourceReadFailure extends Schema.TaggedError<
  SourceReadFailure,
  { readonly brand: unique symbol }
>()("SourceReadFailure", {
  reason: Schema.Literals([
    "unavailable",
    "invalid-facts",
    "capture-identity-changed",
  ]),
  sourceRef: Text,
  hint: Text,
}) {}

export interface ReadListSnapshot<Fact> {
  readonly capturePage: (
    request: typeof SnapshotPageRequest.Type
  ) => Effect.Effect<
    | {
        readonly kind: "pending";
        readonly resumeCursor: string;
        readonly retryAfterMs: number;
      }
    | {
        readonly kind: "page";
        readonly facts: ReadonlyArray<Fact>;
        readonly nextCursor: string | null;
        readonly receipt: typeof CaptureReceipt.Type;
      },
    SourceReadFailure
  >;
}

export const decodeListImportPolicy = Schema.decodeUnknownEffect(
  ListImportPolicy,
  { onExcessProperty: "error" }
);
export const decodeListCensus = Schema.decodeUnknownEffect(ListCensus, {
  onExcessProperty: "error",
});
```

Instantiate `ReadListSnapshot<Fact>` with the domain's decoded contact/preference/stop/activity/automation fact union. Provide it through `Context.Service`.

Validate pending/page results and numeric bounds with output Schemas. The generic interface does not replace that validation. Keep cursors and facts private. Match each receipt to its requested job, scope, snapshot, and section.

Use safe receipt handles or public sources in `SourcePin.reference` and `evidenceRef`. Keep signed export URLs, credentials, and raw cursors out of those fields.

The owning domain replaces plain identifier strings with its scoped/branded ids. Validate unique rule ids, recognized evidence kinds, correct target/parameter combinations, and base/snapshot/scope equality before evaluation.

Refuse an unknown rule version or matcher. Show the supported branches. Never silently select everyone.

Incomplete history produces an unknown inactivity result. Do not replace it with an empty event set.

A first-event-only selector can use observed positive human evidence. Its receipt names the repeat-event coverage gap. A conservative cohort choice does not declare excluded people inactive or permanently stopped.

DNS failures and empty MX answers remain separate review observations. They cannot be smuggled into the confirmed bad-DNS matcher. Review-only observations need provenance even when they do not participate in a quarantine union.

## Capability boundaries

- **Census**:
  - Input: Scope and source-capture request.
  - Output: Exact/bounded/unknown sections with coverage and receipts.
  - Source authority: No customer-state writes.
- **Plan import**:
  - Input: Decoded policy, pinned base, and source receipts.
  - Output: Independent sets, overlaps, union, waterfall, and private manifest digest.
  - Planner: Pure.
- **Import**:
  - Input: Approved plan digest, destination scope, and stable operation key.
  - Output: Stop/profile receipts, rejected records, resume checkpoint, and exact readback.
  - Writer: Authorized destination services.

Make all agent surfaces projections of these contracts. Keep live-write authority in the server composition, not in a client-supplied `approved: true` field. The importer recomputes the plan from the same policy and pinned inputs. It does not trust client counts.

The policy digest covers accepted bytes or a documented canonical encoding. Reformatting requires a new byte digest, even when decoded values stay unchanged. Preserve the original receipt. Record its relationship to the formatted artifact.
