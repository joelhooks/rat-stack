import * as Domain from "@alchemy.run/domain";

export class UnseenItem extends Domain.Rejection(
  "UnseenItem",
  {},
  {
    description:
      "Record a sighting before deciding whether to keep or drop the item.",
  }
) {}
