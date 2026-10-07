import { Schema } from "effect";

export class WebsiteBindingError extends Schema.TaggedError<WebsiteBindingError>()(
  "WebsiteBindingError",
  { cause: Schema.Defect(), message: Schema.String }
) {}
