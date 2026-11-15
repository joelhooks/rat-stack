import * as Schema from "effect/Schema";

export const ItemKind = Schema.Literals(["repo", "post", "video", "news"]);

export const Metrics = Schema.Struct({
  stars: Schema.optionalKey(Schema.Natural),
  views: Schema.optionalKey(Schema.Natural),
  likes: Schema.optionalKey(Schema.Natural),
  pushedAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

export const Sighting = Schema.Struct({
  kind: ItemKind,
  source: Schema.NonEmptyString,
  observedAt: Schema.DateTimeUtcFromString,
  author: Schema.optional(Schema.NonEmptyString),
  metrics: Metrics,
});
