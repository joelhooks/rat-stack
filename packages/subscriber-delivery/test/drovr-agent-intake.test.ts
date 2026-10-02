import { expect, it } from "@effect/vitest";
import { SubscriberIntake } from "@rat-stack/core/interest";
import type { AgentIntakeRequest } from "@rat-stack/core/interest";
import {
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { drovrAgentIntakeLayer } from "../src/drovr-agent-intake.js";

const payload: AgentIntakeRequest = {
  agentRef: "test-agent",
  clientBucket: { ipHash: "a".repeat(64), uaHash: "b".repeat(64) },
  email: "fictional@example.test",
  hold: false,
  score: 0.2,
  signals: ["test"],
  source: "agent",
  submissionId: "test-submission",
  ticket: "test-ticket",
};

const browser = Layer.succeed(SubscriberIntake, {
  submit: () => Effect.succeed({ kind: "accepted" } as const),
});

const layer = (
  client: Layer.Layer<HttpClient.HttpClient>,
  credential: string | undefined
) =>
  drovrAgentIntakeLayer({
    credential:
      credential === undefined
        ? Option.none()
        : Option.some(Redacted.make(credential)),
    url: Option.some("https://intake.test/submit"),
  }).pipe(Layer.provide(Layer.mergeAll(browser, client)));

const submit = SubscriberIntake.use((intake) =>
  intake.agent === undefined
    ? Effect.die(new Error("missing agent adapter"))
    : intake.agent.submit(payload)
);

const Scenario = Schema.Struct({
  afterSeconds: Schema.Literals([-1, 0, 2, 60]),
  status: Schema.Literals([200, 202, 400, 401, 422, 429, 503]),
  validBody: Schema.Boolean,
});

it.effect.prop(
  "acceptance and retry require the exact agent response shapes",
  { scenario: Arbitrary.schema(Scenario) },
  ({ scenario }) => {
    const success =
      scenario.status === 503
        ? { retryAfterSeconds: scenario.afterSeconds }
        : { accepted: true };

    const body = scenario.validBody ? success : { accepted: false };

    const client = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(body, { status: scenario.status })
          )
        )
      )
    );

    return submit.pipe(
      Effect.provide(layer(client, "agent-only-secret")),
      Effect.tap((result) =>
        Effect.sync(() => {
          if (scenario.status === 202 && scenario.validBody) {
            expect(result).toEqual({ kind: "accepted" });
          } else if (
            scenario.status === 503 &&
            scenario.validBody &&
            scenario.afterSeconds >= 0
          ) {
            expect(result).toEqual({
              afterSeconds: scenario.afterSeconds,
              kind: "retry",
            });
          } else {
            expect(result).toEqual({ kind: "refused" });
          }
        })
      )
    );
  }
);

it.effect(
  "uses only the agent credential and envelope; browser intake remains separate",
  () =>
    Effect.gen(function* exactEnvelope() {
      const client = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          expect(request.headers.authorization).toBe(
            "Bearer agent-only-secret"
          );
          expect(request.body._tag).toBe("Uint8Array");

          if (Predicate.isTagged(request.body, "Uint8Array")) {
            const decoded = Schema.decodeUnknownSync(
              Schema.fromJsonString(
                Schema.Struct({
                  agentRef: Schema.String,
                  clientBucket: Schema.Struct({
                    ipHash: Schema.String,
                    uaHash: Schema.String,
                  }),
                  email: Schema.String,
                  hold: Schema.Boolean,
                  score: Schema.Finite,
                  signals: Schema.Array(Schema.String),
                  source: Schema.Literal("agent"),
                  submissionId: Schema.String,
                  ticket: Schema.String,
                })
              )
            )(new TextDecoder().decode(request.body.body));

            expect(decoded).toEqual(payload);
            expect(new TextDecoder().decode(request.body.body)).not.toContain(
              "challenge"
            );
          }

          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ accepted: true }, { status: 202 })
            )
          );
        })
      );

      expect(
        yield* submit.pipe(Effect.provide(layer(client, "agent-only-secret")))
      ).toEqual({ kind: "accepted" });
      expect(
        yield* SubscriberIntake.use((intake) =>
          intake.submit({
            challenge: "shield",
            clientBucket: payload.clientBucket,
            email: payload.email,
            submissionId: "browser",
          })
        ).pipe(Effect.provide(layer(client, "agent-only-secret")))
      ).toEqual({ kind: "accepted" });
    })
);

it.effect(
  "an unset or blank agent credential cannot fall back to browser delivery",
  () =>
    Effect.gen(function* disabled() {
      let calls = 0;

      const client = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => {
          calls += 1;

          return Effect.die(new Error("must not call"));
        })
      );

      for (const credential of [undefined, "", " "]) {
        expect(
          yield* submit.pipe(Effect.provide(layer(client, credential)))
        ).toEqual({ kind: "refused" });
        expect(
          yield* SubscriberIntake.use((intake) =>
            Effect.succeed(intake.agent?.enabled)
          ).pipe(Effect.provide(layer(client, credential)))
        ).toBe(false);
      }

      expect(calls).toBe(0);
    })
);

it.effect(
  "twenty-second timeout requests same-submission replay and errors never log payloads",
  () =>
    Effect.gen(function* timeoutAndPrivacy() {
      const logs: unknown[] = [];

      const client = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.never)
      );

      const fiber = yield* Effect.forkChild(
        submit.pipe(Effect.provide(layer(client, "agent-only-secret")))
      );

      yield* TestClock.adjust("20 seconds");
      expect(yield* Fiber.join(fiber)).toEqual({
        afterSeconds: 0,
        kind: "retry",
      });

      const failing = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() =>
          Effect.die(new Error(`${payload.email} agent-only-secret`))
        )
      );

      expect(
        yield* submit.pipe(
          Effect.provide(
            Layer.mergeAll(
              layer(failing, "agent-only-secret"),
              Logger.layer([Logger.make(({ message }) => logs.push(message))])
            )
          )
        )
      ).toEqual({ afterSeconds: 0, kind: "retry" });
      expect(JSON.stringify(logs)).not.toContain(payload.email);
      expect(JSON.stringify(logs)).not.toContain("agent-only-secret");
    })
);
