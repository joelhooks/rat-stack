import {
  IntakeApplications,
  IntakeApplicationsUnavailable,
  IntakeApplicationsSchema,
  intakeApplications,
} from "@rat-stack/core/join-interest";
import {
  Config,
  Console,
  Effect,
  Layer,
  Logger,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { intakeEraseCommand } from "./intake-erase.js";

export const remoteIntakeApplicationsLayer = (baseUrl: string) =>
  Layer.effect(
    IntakeApplications,
    Effect.gen(function* makeRemoteApplications() {
      const token = yield* Config.Redacted("INTEREST_OPERATOR_TOKEN");
      const http = yield* HttpClient.HttpClient;

      return {
        list: (submissionId?: string) =>
          Effect.gen(function* listRemoteApplications() {
            const url = new URL("/operator/interest/applications", baseUrl);

            if (
              url.protocol !== "https:" &&
              !(
                url.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
              )
            ) {
              return yield* new IntakeApplicationsUnavailable({});
            }

            if (url.username !== "" || url.password !== "") {
              return yield* new IntakeApplicationsUnavailable({});
            }

            if (submissionId !== undefined) {
              url.searchParams.set("submissionId", submissionId);
            }

            const response = yield* http.execute(
              HttpClientRequest.get(url).pipe(
                HttpClientRequest.setHeader(
                  "authorization",
                  `Bearer ${Redacted.value(token)}`
                )
              )
            );

            if (response.status !== 200) {
              return yield* new IntakeApplicationsUnavailable({});
            }

            return yield* response.json.pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(IntakeApplicationsSchema)
              )
            );
          }).pipe(
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

export const intakeCommand = Command.make("intake").pipe(
  Command.withSubcommands([
    intakeEraseCommand,
    Command.make(
      "list",
      {
        baseUrl: Flag.String("base-url").pipe(
          Flag.withDefault("https://ratstack.sh")
        ),
        submissionId: Flag.String("submission-id").pipe(Flag.optional),
      },
      ({ baseUrl, submissionId }) =>
        intakeApplications
          .handler(
            Option.isSome(submissionId)
              ? { submissionId: submissionId.value }
              : {}
          )
          .pipe(
            Effect.flatMap((applications) =>
              Console.log(JSON.stringify(applications, null, 2))
            ),
            Effect.provide(
              remoteIntakeApplicationsLayer(baseUrl).pipe(
                Layer.provide(FetchHttpClient.layer)
              )
            ),
            Effect.withTracerEnabled(false),
            Effect.provide(Logger.layer([])),
            Effect.catchCause(() =>
              Console.error(
                "Applications unavailable. Check the base URL and INTEREST_OPERATOR_TOKEN."
              ).pipe(
                Effect.andThen(
                  Effect.fail(new IntakeApplicationsUnavailable({}))
                )
              )
            )
          )
    ).pipe(
      Command.withDescription(
        "Print private applications as JSON to stdout; use --submission-id for historical submissions"
      )
    ),
  ])
);
