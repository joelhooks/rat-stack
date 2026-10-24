import { Schema } from "effect";

export class ActorNotFound extends Schema.TaggedError<
  ActorNotFound,
  { readonly brand: unique symbol }
>()("ActorNotFound", {
  actorId: Schema.String,
  available: Schema.Array(Schema.String),
}) {}
