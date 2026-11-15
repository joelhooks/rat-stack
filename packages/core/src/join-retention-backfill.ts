import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import type { Effect } from "effect";
import { Context, Schema } from "effect";

export const JoinRetentionCountsSchema = Schema.Struct({
  current: Schema.Int,
  erase: Schema.Int,
  finished: Schema.Int,
  gone: Schema.Int,
  legacyHandoffTimeUnknown: Schema.Int.annotate({
    description:
      "Legacy contacts which may have reached drovr but whose first dispatch time is unknown. Forward their erasure with the slice 1 deploy date as an upper bound, not an invented dispatch timestamp.",
  }),
  pending: Schema.Int,
  unreadable: Schema.Int,
});

export class JoinRetentionBackfill extends Context.Service<
  JoinRetentionBackfill,
  {
    readonly run: (
      dryRun: boolean
    ) => Effect.Effect<typeof JoinRetentionCountsSchema.Type>;
  }
>()("@rat-stack/core/JoinRetentionBackfill") {}

export const joinRetentionBackfillContract = defineContract(
  "joinRetentionBackfill",
  {
    annotations: { readOnly: false },
    description:
      "Migrate legacy sealed signup contacts to bounded retention. Dry-run is the default; apply must be explicit. Returns counts only, never contact data.",
    failure: Schema.Never,
    input: Schema.Struct({ apply: Schema.optionalKey(Schema.Boolean) }),
    output: JoinRetentionCountsSchema,
  }
);

export const joinRetentionBackfill = implement(
  joinRetentionBackfillContract,
  ({ apply }) =>
    JoinRetentionBackfill.use((service) => service.run(apply !== true))
);
