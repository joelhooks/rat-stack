import { Schema } from "effect";

export const JoinRetentionDiagnosticSchema = Schema.Struct({
  step: Schema.Literals([
    "index",
    "migrate",
    "handoff",
    "route_not_configured",
    "route_unavailable",
    "route_defect",
  ]),
  submissionId: Schema.NullOr(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(256),
      Schema.isPattern(/^[a-zA-Z0-9_-]+$/u)
    )
  ),
  kind: Schema.Literals([
    "JoinContactUnreadable",
    "RpcError",
    "DurableObjectError",
    "Timeout",
    "Interrupt",
    "Defect",
  ]),
  name: Schema.NullOr(
    Schema.Literals([
      "Error",
      "TypeError",
      "RangeError",
      "ReferenceError",
      "SyntaxError",
      "URIError",
      "EvalError",
      "AggregateError",
      "DOMException",
      "Unknown",
    ])
  ),
});

export const JoinRetentionFailureResponseSchema = Schema.Struct({
  error: Schema.Literal("applications_unavailable"),
  ...JoinRetentionDiagnosticSchema.fields,
});

export class JoinRetentionBackfillUnavailable extends Schema.TaggedError<
  JoinRetentionBackfillUnavailable,
  { readonly brand: unique symbol }
>()("JoinRetentionBackfillUnavailable", {
  reason: Schema.String,
  diagnostic: Schema.optionalKey(JoinRetentionDiagnosticSchema),
}) {
  override get message(): string {
    return this.reason;
  }
}
