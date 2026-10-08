import { Effect } from "effect";
import { HttpClient } from "effect/http";

export const wordCount = Effect.gen(function* countWords() {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get("https://ratstack.sh/llms.txt");
  const text = yield* response.text;

  return text.split(/\s+/u).length;
});
