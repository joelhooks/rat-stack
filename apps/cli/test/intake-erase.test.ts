import { expect, it } from "@effect/vitest";
import { CallWatch } from "@rat-stack/capability/call-watch";
import { IntakeErasure, intakeErase } from "@rat-stack/core/join-interest";
import { ConfigProvider, Effect, Layer, Logger, Match, Tracer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  intakeEraseCommand,
  remoteIntakeErasureLayer,
} from "../src/intake-erase.js";

it.effect(
  "sends repeated submission ids to the private erase endpoint and returns only counts without telemetry",
  () =>
    Effect.gen(function* remoteErasure() {
      const requests: {
        method: string;
        url: string;
        authorization: string | undefined;
        body: string;
      }[] = [];

      const logs: unknown[] = [];
      const spans: Tracer.NativeSpan[] = [];
      const observed: unknown[] = [];
      const counts = { alreadyGone: 1, erased: 2, failed: 0 };

      const client = HttpClient.make((request, url) => {
        requests.push({
          authorization: request.headers.authorization,
          body: Match.value(request.body).pipe(
            Match.tag("Uint8Array", (body) =>
              new TextDecoder().decode(body.body)
            ),
            Match.orElse(() => "")
          ),
          method: request.method,
          url: url.href,
        });

        return Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json(counts))
        );
      });

      const result = yield* intakeErase
        .handler({
          submissionIds: [
            "synthetic-first",
            "synthetic-second",
            "synthetic-gone",
          ],
        })
        .pipe(
          Effect.provide(
            Layer.mergeAll(
              remoteIntakeErasureLayer("https://operator.example.test").pipe(
                Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
                Layer.provide(
                  ConfigProvider.layer(
                    ConfigProvider.fromUnknown({
                      INTEREST_OPERATOR_TOKEN: "synthetic-token",
                    })
                  )
                )
              ),
              Logger.layer([Logger.make(({ message }) => logs.push(message))])
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
          ),
          Effect.provideService(CallWatch, {
            around: (_contract, input, run) => {
              observed.push(input);

              return run;
            },
          })
        );

      expect(result).toEqual(counts);
      expect(requests).toEqual([
        {
          authorization: "Bearer synthetic-token",
          body: JSON.stringify({
            submissionIds: [
              "synthetic-first",
              "synthetic-second",
              "synthetic-gone",
            ],
          }),
          method: "POST",
          url: "https://operator.example.test/operator/interest/applications/erase",
        },
      ]);
      expect(logs).toEqual([]);
      expect(spans).toEqual([]);
      expect(observed).toEqual([]);
      expect(intakeEraseCommand.name).toBe("erase");
    })
);

it.effect(
  "sanitizes remote erasure refusals and rejects invalid counts and insecure destinations",
  () =>
    Effect.gen(function* erasedFailures() {
      for (const [baseUrl, response] of [
        [
          "https://operator.example.test",
          new Response("synthetic-private-value", { status: 401 }),
        ],
        [
          "https://operator.example.test",
          Response.json({ alreadyGone: 0, erased: -1, failed: 0 }),
        ],
        [
          "http://operator.example.test",
          Response.json({ alreadyGone: 0, erased: 1, failed: 0 }),
        ],
        [
          "https://user:password@operator.example.test",
          Response.json({ alreadyGone: 0, erased: 1, failed: 0 }),
        ],
      ] as const) {
        const eraser = yield* IntakeErasure.pipe(
          Effect.provide(
            remoteIntakeErasureLayer(baseUrl).pipe(
              Layer.provide(
                Layer.succeed(
                  HttpClient.HttpClient,
                  HttpClient.make((request) =>
                    Effect.succeed(
                      HttpClientResponse.fromWeb(request, response)
                    )
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
            )
          )
        );

        const failure = yield* eraser
          .erase(["synthetic-submission"])
          .pipe(Effect.flip);

        expect(failure._tag).toBe("IntakeApplicationsUnavailable");
        expect(JSON.stringify(failure)).not.toContain(
          "synthetic-private-value"
        );
        expect(JSON.stringify(failure)).not.toContain("synthetic-token");
        expect(JSON.stringify(failure)).not.toContain("synthetic-submission");
      }
    })
);
