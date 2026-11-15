import { Schema } from "effect";

export class HelpLimitReached extends Schema.TaggedError<
  HelpLimitReached,
  { readonly brand: unique symbol }
>()(
  "HelpLimitReached",
  {
    limit: Schema.Literals(["per-attendee", "total"]),
    message: Schema.String,
  },
  { httpApiStatus: 429 }
) {}
