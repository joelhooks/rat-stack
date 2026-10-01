import { Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

const wordCharacters = Schema.Literals([
  "a",
  "e",
  "k",
  "o",
  "s",
  "t",
  "u",
  "x",
  "0",
  "7",
  "-",
  "_",
]);

export const word = Arbitrary.array(Arbitrary.schema(wordCharacters), {
  maxLength: 10,
  minLength: 1,
}).pipe(Arbitrary.map((characters) => characters.join("")));

export const sensitiveWord = Arbitrary.schema(
  Schema.Literals([
    "token",
    "access_token",
    "Email",
    "api_key",
    "password",
    "session_id",
    "code",
    "sig",
    "SECRET",
  ])
);

export const queryKey = Arbitrary.flatMap(
  Arbitrary.schema(Schema.Boolean),
  (sensitive) => (sensitive ? sensitiveWord : word)
);

export const queryPairs = Arbitrary.array(Arbitrary.all([queryKey, word]), {
  maxLength: 12,
});
