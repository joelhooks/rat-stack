import { Schema } from "effect";

export const RequestBodySchema = Schema.Struct({
  accept: Schema.optionalKey(Schema.String),
  contentType: Schema.optionalKey(Schema.String),
  durationMs: Schema.Finite,
  method: Schema.String,
  path: Schema.String,
  query: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  referrer: Schema.optionalKey(Schema.String),
  signedAgent: Schema.Boolean,
  status: Schema.Int,
  type: Schema.Literal("request"),
});

export type RequestBody = typeof RequestBodySchema.Type;
