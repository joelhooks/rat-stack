import { Effect, Schema } from "effect";

export const MatchSchema = Schema.Struct({
  kind: Schema.Literals(["lore", "system", "skill"]),
  score: Schema.Finite,
  title: Schema.String,
});

export type Match = typeof MatchSchema.Type;

const decodeMatch = Schema.decodeEffect(Schema.fromJsonString(MatchSchema));

export const program = Effect.gen(function* readMatch() {
  const match = yield* decodeMatch(
    '{"kind":"lore","score":1,"title":"Layers"}'
  );

  return match.title;
});
