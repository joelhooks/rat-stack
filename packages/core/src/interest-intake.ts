import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export interface IntakeRequest {
  readonly challenge: string;
  readonly clientBucket: {
    readonly ipHash: string;
    readonly uaHash: string;
  };
  readonly email: string;
  readonly submissionId: string;
}

export type IntakeResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused" }
  | { readonly kind: "retry"; readonly afterSeconds: number };

export interface IntakeSettings {
  readonly credential: Option.Option<Redacted.Redacted>;
  readonly url: Option.Option<string>;
}

export class DrovrIntake extends Context.Service<
  DrovrIntake,
  { readonly submit: (request: IntakeRequest) => Effect.Effect<IntakeResult> }
>()("@rat-stack/core/DrovrIntake") {}

const INTAKE_TIMEOUT_ABOVE_DROVR_VERIFY_AND_SEND = "20 seconds";

const accepted: IntakeResult = { kind: "accepted" };

const refused: IntakeResult = { kind: "refused" };

const timedOutReplaySameSubmission: IntakeResult = {
  afterSeconds: 0,
  kind: "retry",
};

const Unavailable = Schema.Struct({ retryAfterSeconds: Schema.Finite });

const decodeUnavailable = Schema.decodeUnknownEffect(Unavailable);

export const drovrIntakeLayer = (settings: IntakeSettings) =>
  Layer.effect(
    DrovrIntake,
    Effect.gen(function* makeDrovrIntake() {
      const http = yield* HttpClient.HttpClient;

      const submit = Effect.fn("DrovrIntake.submit")(function* submit(
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
          return timedOutReplaySameSubmission;
        }

        const response = outcome.value;

        if (Option.isNone(response)) {
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

        return refused;
      });

      return { submit };
    })
  );
