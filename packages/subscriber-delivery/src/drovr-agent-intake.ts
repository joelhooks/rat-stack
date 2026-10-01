import { SubscriberIntake } from "@rat-stack/core/interest";
import type {
  AgentIntakeRequest,
  IntakeResult,
} from "@rat-stack/core/interest";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import type { IntakeSettings } from "./drovr-intake.js";

const Accepted = Schema.Struct({ accepted: Schema.Literal(true) });

const Unavailable = Schema.Struct({
  retryAfterSeconds: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

const refused: IntakeResult = { kind: "refused" };

const retry: IntakeResult = { afterSeconds: 0, kind: "retry" };

export const drovrAgentIntakeLayer = (settings: IntakeSettings) =>
  Layer.effect(
    SubscriberIntake,
    Effect.gen(function* makeAgentIntake() {
      const browser = yield* SubscriberIntake;
      const http = yield* HttpClient.HttpClient;

      const enabled =
        Option.isSome(settings.url) &&
        Option.isSome(settings.credential) &&
        Redacted.value(settings.credential.value).trim() !== "";

      const submit = Effect.fn("SubscriberIntake.agent.submit")(
        function* submit(input: AgentIntakeRequest) {
          if (
            !enabled ||
            Option.isNone(settings.url) ||
            Option.isNone(settings.credential)
          ) {
            return refused;
          }

          const request = HttpClientRequest.post(settings.url.value).pipe(
            HttpClientRequest.bearerToken(
              Redacted.value(settings.credential.value)
            ),
            HttpClientRequest.bodyJsonUnsafe(input)
          );

          return yield* http.execute(request).pipe(
            Effect.flatMap((response) => {
              if (response.status === 202) {
                return response.json.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Accepted)),
                  Effect.as<IntakeResult>({ kind: "accepted" }),
                  Effect.catchCause(() => Effect.succeed(refused))
                );
              }

              if (response.status === 503) {
                return response.json.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Unavailable)),
                  Effect.map(({ retryAfterSeconds }): IntakeResult => ({
                    afterSeconds: retryAfterSeconds,
                    kind: "retry",
                  })),
                  Effect.catchCause(() => Effect.succeed(refused))
                );
              }

              return Effect.logWarning("drovr agent intake refused", {
                status: response.status,
              }).pipe(Effect.as(refused));
            }),
            Effect.timeoutOption("20 seconds"),
            Effect.map(Option.getOrElse(() => retry)),
            Effect.catchCause(() =>
              Effect.logWarning("drovr agent intake unreachable").pipe(
                Effect.as(retry)
              )
            )
          );
        }
      );

      return { ...browser, agent: { enabled, submit } };
    })
  );
