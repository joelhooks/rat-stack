import { Schema } from "effect";

export class PublicAuthBundleLeak extends Schema.TaggedError<PublicAuthBundleLeak>()(
  "PublicAuthBundleLeak",
  {
    modules: Schema.Array(Schema.String),
  }
) {}
