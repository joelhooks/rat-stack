import {
  JoinInterest,
  JOIN_NOT_OPEN,
  joinInterestContract,
} from "@rat-stack/core/join-interest";
import type { JoinInput } from "@rat-stack/core/join-interest";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export const remoteJoinInterestLayer = Layer.effect(
  JoinInterest,
  Effect.gen(function* makeRemoteJoinInterest() {
    const http = yield* HttpClient.HttpClient;

    return {
      submit: Effect.fn("JoinInterest.remote")(function* submit(
        input: JoinInput
      ) {
        return yield* http
          .execute(
            HttpClientRequest.post("https://ratstack.sh/api/joinInterest").pipe(
              HttpClientRequest.bodyJsonUnsafe(input)
            )
          )
          .pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(
              Schema.decodeUnknownEffect(joinInterestContract.output)
            ),
            Effect.timeout("90 seconds"),
            Effect.catchCause(() =>
              Effect.succeed({
                message: JOIN_NOT_OPEN,
                statusRef: "unavailable",
              } as const)
            )
          );
      }),
    };
  })
).pipe(Layer.provide(FetchHttpClient.layer));
