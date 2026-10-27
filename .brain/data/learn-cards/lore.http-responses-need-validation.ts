import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

const Release = Schema.Struct({ version: Schema.Int });

export class ReleaseError extends Schema.TaggedError<
  ReleaseError,
  { readonly brand: unique symbol }
>()("ReleaseError", {
  cause: Schema.Defect(),
  phase: Schema.Literals(["status", "body"]),
}) {}

export const latestRelease = Effect.gen(function* readRelease() {
  const response = yield* (yield* HttpClient.HttpClient)
    .pipe(HttpClient.filterStatusOk)
    .get("https://provider.example.test/version")
    .pipe(
      Effect.mapError((cause) => new ReleaseError({ cause, phase: "status" }))
    );

  return yield* HttpClientResponse.schemaBodyJson(Release)(response).pipe(
    Effect.mapError((cause) => new ReleaseError({ cause, phase: "body" }))
  );
});
