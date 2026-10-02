import { expect, it } from "@effect/vitest";
import {
  IntakeApplications,
  intakeApplications,
} from "@rat-stack/core/join-interest";
import { ConfigProvider, Effect, Layer, Logger, Tracer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { remoteIntakeApplicationsLayer } from "../src/intake.js";

it.effect(
  "reads applications with environment authorization and historical lookup without telemetry",
  () =>
    Effect.gen(function* remoteReader() {
      const calls: { url: string; authorization: string | undefined }[] = [];
      const spans: Tracer.NativeSpan[] = [];
      const logs: unknown[] = [];

      const client = HttpClient.make((request, url) => {
        calls.push({
          authorization: request.headers.authorization,
          url: url.href,
        });

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json([
              {
                answers: {},
                email: "synthetic@example.test",
                hold: false,
                name: "Fake Applicant",
                score: 0,
                share: false,
                signals: [],
                source: "agent",
                state: "forwarded",
                submissionId: "synthetic-submission",
                submittedAt: "2026-10-01T18:00:00.000Z",
                x: "https://x.com/fake_applicant",
              },
              {
                reason: "no answers: legacy browser signup or erased contact",
                state: "no-answers",
                submissionId: "legacy-submission",
              },
            ])
          )
        );
      });

      const output = yield* intakeApplications
        .handler({ submissionId: "legacy-submission" })
        .pipe(
          Effect.provide(
            Layer.mergeAll(
              Logger.layer([Logger.make(({ message }) => logs.push(message))]),
              remoteIntakeApplicationsLayer(
                "https://operator.example.test"
              ).pipe(
                Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
                Layer.provide(
                  ConfigProvider.layer(
                    ConfigProvider.fromUnknown({
                      INTEREST_OPERATOR_TOKEN: "synthetic-operator-token",
                    })
                  )
                )
              )
            )
          ),
          Effect.provideService(
            Tracer.Tracer,
            Tracer.make({
              span: (options) => {
                const span = new Tracer.NativeSpan(options);
                spans.push(span);

                return span;
              },
            })
          )
        );

      expect(output).toEqual([
        {
          answers: {},
          email: "synthetic@example.test",
          hold: false,
          name: "Fake Applicant",
          score: 0,
          share: false,
          signals: [],
          source: "agent",
          state: "forwarded",
          submissionId: "synthetic-submission",
          submittedAt: "2026-10-01T18:00:00.000Z",
          x: "https://x.com/fake_applicant",
        },
        {
          reason: "no answers: legacy browser signup or erased contact",
          state: "no-answers",
          submissionId: "legacy-submission",
        },
      ]);
      expect(calls).toEqual([
        {
          authorization: "Bearer synthetic-operator-token",
          url: "https://operator.example.test/operator/interest/applications?submissionId=legacy-submission",
        },
      ]);
      expect(logs).toEqual([]);
      expect(spans).toEqual([]);
    })
);

it.effect(
  "turns refusal, invalid responses and insecure destinations into data-free failures",
  () =>
    Effect.gen(function* sanitizedFailures() {
      for (const [baseUrl, response] of [
        [
          "https://operator.example.test",
          new Response("synthetic-secret-body", { status: 401 }),
        ],
        [
          "https://operator.example.test",
          Response.json({ email: "synthetic@example.test" }),
        ],
        ["http://operator.example.test", Response.json([])],
        ["https://user:password@operator.example.test", Response.json([])],
      ] as const) {
        const layer = remoteIntakeApplicationsLayer(baseUrl).pipe(
          Layer.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(HttpClientResponse.fromWeb(request, response))
              )
            )
          ),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                INTEREST_OPERATOR_TOKEN: "synthetic-token",
              })
            )
          )
        );

        const reader = yield* IntakeApplications.pipe(Effect.provide(layer));
        const failure = yield* reader.list().pipe(Effect.flip);
        expect(failure._tag).toBe("IntakeApplicationsUnavailable");
        expect(JSON.stringify(failure)).not.toContain("synthetic-secret-body");
        expect(JSON.stringify(failure)).not.toContain("synthetic@example.test");
        expect(JSON.stringify(failure)).not.toContain("synthetic-token");
      }
    })
);
