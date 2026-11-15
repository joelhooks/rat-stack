import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class InvalidWindow extends Domain.Rejection(
  "InvalidWindow",
  {
    maximumDays: Schema.Int,
  },
  {
    description:
      "Use from before until, with a positive window no longer than maximumDays.",
  }
) {}
