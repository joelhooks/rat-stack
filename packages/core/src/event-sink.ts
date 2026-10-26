import { Context, Effect, Schema } from "effect";

import { RequestGeoSchema } from "./request-geo.js";

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
  ...RequestGeoSchema.fields,
  host: Schema.String,
  ipHash: Schema.optionalKey(Schema.String),
  receivedAt: Schema.String,
  userAgent: Schema.optionalKey(Schema.String),
});

export type ServerContext = typeof ServerContextSchema.Type;

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

export class EventSinkError extends Schema.TaggedError<
  EventSinkError,
  { readonly brand: unique symbol }
>()("EventSinkError", { cause: Schema.Defect() }) {}

export interface EventSinkService {
  readonly send: (
    events: readonly RawEvent[]
  ) => Effect.Effect<void, EventSinkError>;
}

export const EventSink = Context.Reference<EventSinkService>(
  "@rat-stack/core/EventSink",
  { defaultValue: () => ({ send: () => Effect.void }) }
);
