import type { Flag } from "@rat-stack/core/flags";
import { DateTime, Effect, Schema } from "effect";

export class ExpiredFlags extends Schema.TaggedError<ExpiredFlags>()(
  "ExpiredFlags",
  {
    flags: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        owner: Schema.String,
        removeBy: Schema.String,
      })
    ),
    repair: Schema.String,
  }
) {}

export const checkFlagExpiry = Effect.fn("checkFlagExpiry")(
  function* checkFlagExpiry(registry: readonly Flag<unknown>[]) {
    const today = DateTime.formatIsoDate(yield* DateTime.now);
    const expired = registry.filter((flag) => flag.removeBy < today);

    if (expired.length > 0) {
      return yield* new ExpiredFlags({
        flags: expired.map(({ name, owner, removeBy }) => ({
          name,
          owner,
          removeBy,
        })),
        repair:
          "Remove each expired flag and replace its call sites with the chosen value. Set a new removal date only after owner review.",
      });
    }

    return yield* Effect.void;
  }
);
