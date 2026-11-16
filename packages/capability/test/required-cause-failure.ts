import { Schema } from "effect";

export class RequiredCauseFailure extends Schema.TaggedError<
  RequiredCauseFailure,
  { readonly brand: unique symbol }
>()("RequiredCauseFailure", {
  cause: Schema.Defect(),
  detail: Schema.String,
}) {}
