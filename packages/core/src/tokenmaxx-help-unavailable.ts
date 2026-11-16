import { Schema } from "effect";

export class HelpUnavailable extends Schema.TaggedError<
  HelpUnavailable,
  { readonly brand: unique symbol }
>()(
  "HelpUnavailable",
  {
    message: Schema.String,
    reason: Schema.Literals(["not-configured", "storage"]),
  },
  { httpApiStatus: 503 }
) {}
