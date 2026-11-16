import {
  IntakeRedeliver,
  IntakeRedeliverySchema,
  IntakeApplicationsUnavailable,
  intakeRedeliver,
} from "@rat-stack/core/join-interest";
import type { IntakeRedeliveryInput } from "@rat-stack/core/join-interest";
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

const redeliverRemoteApplications = Effect.fnUntraced(
  function* redeliverRemoteApplications(
    baseUrl: string,
    token: Redacted.Redacted,
    http: HttpClient.HttpClient,
    input: IntakeRedeliveryInput
  ) {
    const url = new URL("/operator/interest/applications/redeliver", baseUrl);

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
      HttpClientRequest.bodyJson(input)
    );

    const response = yield* http.execute(request);

    if (response.status !== 200) {
      return yield* new IntakeApplicationsUnavailable({});
    }

    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(IntakeRedeliverySchema))
    );
  }
);

export const remoteIntakeRedeliveryLayer = (baseUrl: string) =>
  Layer.effect(
    IntakeRedeliver,
    Effect.gen(function* makeRemoteRedelivery() {
      const token = yield* Config.Redacted("INTEREST_OPERATOR_TOKEN");
      const http = yield* HttpClient.HttpClient;

      return {
        redeliver: (input: IntakeRedeliveryInput) =>
          redeliverRemoteApplications(baseUrl, token, http, input).pipe(
            Effect.withTracerEnabled(false),
            Effect.provideService(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            }),
            Effect.provide(Logger.layer([])),
            Effect.catchCause(() =>
              // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Operator HTTP failures may contain bearer headers or private applications; the CLI error stays opaque.
              Effect.fail(new IntakeApplicationsUnavailable({}))
            )
          ),
      };
    })
  );

export const intakeRedeliverCommand = Command.make(
  "redeliver",
  {
    baseUrl: Flag.String("base-url").pipe(
      Flag.withDefault("https://ratstack.sh")
    ),
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    includeRefused: Flag.Boolean("include-refused").pipe(
      Flag.withDefault(false)
    ),
    releaseHeld: Flag.Boolean("release-held").pipe(Flag.withDefault(false)),
    submissionIds: Flag.String("submission-id").pipe(Flag.atLeast(1)),
  },
  ({ baseUrl, dryRun, includeRefused, releaseHeld, submissionIds }) =>
    intakeRedeliver
      .handler({ dryRun, includeRefused, releaseHeld, submissionIds })
      .pipe(
        Effect.flatMap((result) => Console.log(JSON.stringify(result))),
        Effect.provide(
          remoteIntakeRedeliveryLayer(baseUrl).pipe(
            Layer.provide(FetchHttpClient.layer)
          )
        ),
        Effect.withTracerEnabled(false),
        Effect.provide(Logger.layer([])),
        Effect.catchCause(() =>
          Console.error(
            "Redelivery unavailable. Check the base URL and INTEREST_OPERATOR_TOKEN. The request may have partially completed; read application states before retrying."
          ).pipe(
            // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Redelivery failures must not expose private contact data or credentials after fixed recovery instructions.
            Effect.andThen(Effect.fail(new IntakeApplicationsUnavailable({})))
          )
        )
      )
).pipe(
  Command.withDescription(
    "Redeliver ready applications by repeatable --submission-id; --dry-run inspects all ids without sending; --include-refused explicitly repairs named refusals; --release-held explicitly releases abuse holds"
  )
);
