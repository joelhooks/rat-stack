import { Schema } from "effect";

export class WebsiteBindingError extends Schema.TaggedError<
  WebsiteBindingError,
  { readonly brand: unique symbol }
>()("WebsiteBindingError", {
  cause: Schema.Defect(),
  message: Schema.String,
}) {}
