import { Schema } from "effect";

export const AnonymousIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AnonymousId")
);

export type AnonymousId = typeof AnonymousIdSchema.Type;

export const MessageIdSchema = Schema.String.check(Schema.isUUID(7)).pipe(
  Schema.brand("MessageId")
);

export type MessageId = typeof MessageIdSchema.Type;

export const IdentityModeSchema = Schema.Literals(["daily", "persistent"]);

export type IdentityMode = typeof IdentityModeSchema.Type;

export const EventSourceSchema = Schema.Literals(["worker"]);

export type EventSource = typeof EventSourceSchema.Type;

export const ServerContextSchema = Schema.Struct({
  country: Schema.optionalKey(Schema.String),
  host: Schema.String,
  ipHash: Schema.optionalKey(Schema.String),
  receivedAt: Schema.String,
  userAgent: Schema.optionalKey(Schema.String),
});

export type ServerContext = typeof ServerContextSchema.Type;

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

export const RawEventSchema = Schema.Struct({
  anonymousId: AnonymousIdSchema,
  body: Schema.Json,
  identityMode: IdentityModeSchema,
  messageId: MessageIdSchema,
  server: ServerContextSchema,
  source: EventSourceSchema,
  v: Schema.Literal(1),
});

export type RawEvent = typeof RawEventSchema.Type;
