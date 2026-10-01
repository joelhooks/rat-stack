import { SubscriberIntake } from "@rat-stack/core/interest";
import type { IntakeRequest, IntakeResult } from "@rat-stack/core/interest";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export interface IntakeSettings {
  readonly credential: Option.Option<Redacted.Redacted>;
  readonly url: Option.Option<string>;
}

const INTAKE_TIMEOUT_ABOVE_DROVR_VERIFY_AND_SEND = "20 seconds";

const accepted: IntakeResult = { kind: "accepted" };

const refused: IntakeResult = { kind: "refused" };

const timedOutReplaySameSubmission: IntakeResult = {
  afterSeconds: 0,
  kind: "retry",
};

const Unavailable = Schema.Struct({ retryAfterSeconds: Schema.Finite });

const decodeUnavailable = Schema.decodeUnknownEffect(Unavailable);

const Problem = Schema.Struct({
  traceId: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
});

interface IntakeRefusalLog {
  readonly status: number;
  traceId?: string;
  type?: string;
}

const decodeProblem = Schema.decodeUnknownEffect(Problem);

const PROBLEM_LOG_TIMEOUT = "1 second";

export const drovrIntakeLayer = (settings: IntakeSettings) =>
  Layer.effect(
    SubscriberIntake,
    Effect.gen(function* makeSubscriberIntake() {
      const http = yield* HttpClient.HttpClient;

      const submit = Effect.fn("SubscriberIntake.submit")(function* submit(
        intake: IntakeRequest
      ) {
        if (Option.isNone(settings.url) || Option.isNone(settings.credential)) {
          return refused;
        }

        const request = HttpClientRequest.post(settings.url.value).pipe(
          HttpClientRequest.bearerToken(
            Redacted.value(settings.credential.value)
          ),
          HttpClientRequest.bodyJsonUnsafe(intake)
        );

        const outcome = yield* http.execute(request).pipe(
          Effect.map(Option.some),
          Effect.catchCause(() => Effect.succeed(Option.none())),
          Effect.timeoutOption(INTAKE_TIMEOUT_ABOVE_DROVR_VERIFY_AND_SEND)
        );

        if (Option.isNone(outcome)) {
          yield* Effect.logWarning("drovr intake unreachable");

          return timedOutReplaySameSubmission;
        }

        const response = outcome.value;

        if (Option.isNone(response)) {
          yield* Effect.logWarning("drovr intake unreachable");

          return refused;
        }

        const { status } = response.value;

        if (status >= 200 && status < 300) {
          return accepted;
        }

        if (status === 503) {
          return yield* response.value.json.pipe(
            Effect.flatMap(decodeUnavailable),
            Effect.map(({ retryAfterSeconds }): IntakeResult => ({
              afterSeconds: Math.max(0, retryAfterSeconds),
              kind: "retry",
            })),
            Effect.orElseSucceed(() => refused)
          );
        }

        const problem =
          response.value.headers["content-type"]
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() === "application/problem+json"
            ? yield* response.value.json.pipe(
                Effect.flatMap(decodeProblem),
                Effect.catchCause(() => Effect.void),
                Effect.timeoutOption(PROBLEM_LOG_TIMEOUT),
                Effect.map(Option.getOrUndefined)
              )
            : undefined;

        const refusalDetails: IntakeRefusalLog = { status };

        for (const field of ["type", "traceId"] as const) {
          const value = problem?.[field];

          if (
            value !== undefined &&
            !/(?:@|%40)/iu.test(value) &&
            ![intake.challenge, Redacted.value(settings.credential.value)].some(
              (secret) =>
                secret !== "" &&
                (value.includes(secret) ||
                  value.includes(encodeURIComponent(secret)))
            )
          ) {
            refusalDetails[field] = value;
          }
        }

        yield* Effect.logWarning("drovr intake refused", refusalDetails);

        return refused;
      });

      return { submit };
    })
  );
