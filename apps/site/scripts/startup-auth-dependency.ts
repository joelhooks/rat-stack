import { Schema } from "effect";

export class PublicAuthBundleLeak extends Schema.TaggedError<
  PublicAuthBundleLeak,
  { readonly brand: unique symbol }
>()("PublicAuthBundleLeak", {
  modules: Schema.Array(Schema.String),
}) {}
