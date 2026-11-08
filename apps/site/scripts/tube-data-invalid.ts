import { Schema } from "effect";

export class TubeDataInvalid extends Schema.TaggedError<
  TubeDataInvalid,
  { readonly brand: unique symbol }
>()("TubeDataInvalid", {
  message: Schema.String,
  problems: Schema.Array(Schema.String),
}) {}
