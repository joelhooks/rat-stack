import { Schema } from "effect";

export class ReportNotFound extends Schema.TaggedError<
  ReportNotFound,
  { readonly brand: unique symbol }
>()(
  "ReportNotFound",
  { message: Schema.String, reportId: Schema.String },
  { httpApiStatus: 404 }
) {}
