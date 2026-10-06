import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

const Reply = Schema.Struct({ version: Schema.Int });

export class ResponseFixtureError extends Schema.TaggedError<ResponseFixtureError>()(
  "ResponseFixtureError",
  { cause: Schema.Defect(), phase: Schema.Literals(["status", "body"]) }
) {}

export const readValidatedResponse = Effect.fn("readValidatedResponse")(
  function* readValidatedResponse() {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk
    );

    const response = yield* client
      .get("https://provider.example.test/version")
      .pipe(
        Effect.mapError(
          (cause) => new ResponseFixtureError({ cause, phase: "status" })
        )
      );

    return yield* HttpClientResponse.schemaBodyJson(Reply)(response).pipe(
      Effect.mapError(
        (cause) => new ResponseFixtureError({ cause, phase: "body" })
      )
    );
  }
);
