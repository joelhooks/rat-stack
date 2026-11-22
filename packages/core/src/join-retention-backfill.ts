import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import type { Effect } from "effect";
import { Context, Schema } from "effect";

import { JoinRetentionBackfillUnavailable } from "./join-retention-unavailable.js";

export {
  JoinRetentionBackfillUnavailable,
  JoinRetentionDiagnosticSchema,
  JoinRetentionFailureResponseSchema,
} from "./join-retention-unavailable.js";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Cursor = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256)
);

export const JOIN_RETENTION_DEFAULT_LIMIT = 25;

export const JOIN_RETENTION_MAX_LIMIT = 50;

export const JoinRetentionCountsSchema = Schema.Struct({
  current: Count,
  erase: Count,
  finished: Count,
  gone: Count,
  legacyHandoffTimeUnknown: Count.annotate({
    description:
      "Legacy contacts which may have reached drovr but whose first dispatch time is unknown. Forward their erasure with the slice 1 deploy date as an upper bound, not an invented dispatch timestamp.",
  }),
  nextCursor: Schema.NullOr(Cursor),
  pending: Count,
  unreadable: Count,
});

export class JoinRetentionBackfill extends Context.Service<
  JoinRetentionBackfill,
  {
    readonly run: (
      dryRun: boolean,
      after?: string,
      limit?: number
    ) => Effect.Effect<
      typeof JoinRetentionCountsSchema.Type,
      JoinRetentionBackfillUnavailable
    >;
  }
>()("@rat-stack/core/JoinRetentionBackfill") {}

export const joinRetentionBackfillContract = defineContract(
  "joinRetentionBackfill",
  {
    annotations: { readOnly: false },
    description:
      "Migrate readable legacy sealed signup contacts to bounded retention. Preview is informational: normal reads, listings and sweeps already migrate on first access. Preview also deletes expired payloads because reads enforce the cell deadline; expiry is not a subject-erasure request. Explicit apply followed by a repeat preview is required after deployment. Unreadable legacy rows are counted and preserved in both modes unless an existing deadline expires. Walk sorted cursor pages, default 25 IDs and maximum 50 per request. Returns per-page counts and a continuation cursor only, never contact data.",
    failure: JoinRetentionBackfillUnavailable,
    input: Schema.Struct({
      apply: Schema.optionalKey(Schema.Boolean),
      after: Schema.optionalKey(Cursor),
      limit: Schema.optionalKey(
        Schema.Int.check(
          Schema.isBetween({ minimum: 1, maximum: JOIN_RETENTION_MAX_LIMIT })
        )
      ),
    }),
    output: JoinRetentionCountsSchema,
  }
);

export const joinRetentionBackfill = implement(
  joinRetentionBackfillContract,
  ({ apply, after, limit }) =>
    JoinRetentionBackfill.use((service) =>
      service.run(apply !== true, after, limit)
    )
);
