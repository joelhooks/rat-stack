import { expect, it } from "@effect/vitest";
import { intakeRedeliver } from "@rat-stack/core/join-interest";
import { ConfigProvider, Effect, Layer, Match } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { remoteIntakeRedeliveryLayer } from "../src/intake-redeliver.js";

it.effect(
  "operator redelivery posts repeated ids and decodes the ordered partial receipt",
  () =>
    Effect.gen(function* remoteRedelivery() {
      const ids = ["synthetic-first", "synthetic-second", "synthetic-third"];

      const receipt = {
        notAttempted: ["synthetic-third"],
        rows: [
          {
            hold: true,
            outcome: "accepted",
            previousState: "refused",
            state: "accepted",
            submissionId: "synthetic-first",
          },
          {
            hold: false,
            outcome: "retry",
            previousState: "ready",
            state: "ready",
            submissionId: "synthetic-second",
          },
        ],
      };

      const client = HttpClient.make((request, url) => {
        expect(url.href).toBe(
          "https://operator.example.test/operator/interest/applications/redeliver"
        );
        expect(request.method).toBe("POST");
        expect(request.headers.authorization).toBe("Bearer synthetic-token");
        expect(
          Match.value(request.body).pipe(
            Match.tag("Uint8Array", (body) =>
              new TextDecoder().decode(body.body)
            ),
            Match.orElse(() => "")
          )
        ).toBe(
          JSON.stringify({
            dryRun: false,
            includeRefused: true,
            releaseHeld: true,
            submissionIds: ids,
          })
        );

        return Effect.succeed(
          HttpClientResponse.fromWeb(request, Response.json(receipt))
        );
      });

      const result = yield* intakeRedeliver
        .handler({
          dryRun: false,
          includeRefused: true,
          releaseHeld: true,
          submissionIds: ids,
        })
        .pipe(
          Effect.provide(
            remoteIntakeRedeliveryLayer("https://operator.example.test").pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
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

      expect(result).toEqual(receipt);
    })
);
