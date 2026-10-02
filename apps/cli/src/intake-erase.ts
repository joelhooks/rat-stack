import {
  IntakeErasure,
  IntakeEraseCountsSchema,
  IntakeApplicationsUnavailable,
  intakeErase,
} from "@rat-stack/core/join-interest";
import {
  Config,
  Console,
  Effect,
  Layer,
  Logger,
  Redacted,
  Schema,
} from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const eraseRemoteApplications = Effect.fnUntraced(
  function* eraseRemoteApplications(
    baseUrl: string,
    token: Redacted.Redacted,
    http: HttpClient.HttpClient,
    submissionIds: readonly string[]
  ) {
    const url = new URL("/operator/interest/applications/erase", baseUrl);

    if (
      url.username !== "" ||
      url.password !== "" ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    ) {
      return yield* new IntakeApplicationsUnavailable({});
    }

    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader(
        "authorization",
        `Bearer ${Redacted.value(token)}`
      ),
      HttpClientRequest.bodyJson({ submissionIds })
    );

    const response = yield* http.execute(request);

    if (response.status !== 200) {
      return yield* new IntakeApplicationsUnavailable({});
    }

    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(IntakeEraseCountsSchema))
    );
  }
);

export const remoteIntakeErasureLayer = (baseUrl: string) =>
  Layer.effect(
    IntakeErasure,
    Effect.gen(function* makeRemoteErasure() {
      const token = yield* Config.Redacted("INTEREST_OPERATOR_TOKEN");
      const http = yield* HttpClient.HttpClient;

      return {
        erase: (submissionIds: readonly string[]) =>
          eraseRemoteApplications(baseUrl, token, http, submissionIds).pipe(
            Effect.timeout("30 seconds"),
            Effect.withTracerEnabled(false),
            Effect.provideService(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            }),
            Effect.provide(Logger.layer([])),
            Effect.catchCause(() =>
              Effect.fail(new IntakeApplicationsUnavailable({}))
            )
          ),
      };
    })
  );

export const intakeEraseCommand = Command.make(
  "erase",
  {
    baseUrl: Flag.String("base-url").pipe(
      Flag.withDefault("https://ratstack.sh")
    ),
    submissionIds: Flag.String("submission-id").pipe(Flag.atLeast(1)),
  },
  ({ baseUrl, submissionIds }) =>
    intakeErase.handler({ submissionIds }).pipe(
      Effect.flatMap((counts) => Console.log(JSON.stringify(counts))),
      Effect.provide(
        remoteIntakeErasureLayer(baseUrl).pipe(
          Layer.provide(FetchHttpClient.layer)
        )
      ),
      Effect.withTracerEnabled(false),
      Effect.provide(Logger.layer([])),
      Effect.catchCause(() =>
        Console.error(
          "Erasure unavailable. Check the base URL and INTEREST_OPERATOR_TOKEN."
        ).pipe(
          Effect.andThen(Effect.fail(new IntakeApplicationsUnavailable({})))
        )
      )
    )
).pipe(
  Command.withDescription(
    "Erase local applications by repeatable --submission-id; print counts only"
  )
);
