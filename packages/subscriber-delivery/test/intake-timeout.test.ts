import { expect, it } from "@effect/vitest";
import { SubscriberIntake } from "@rat-stack/core/interest";
import type { IntakeRequest } from "@rat-stack/core/interest";
import {
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import { drovrAgentIntakeLayer } from "../src/drovr-agent-intake.js";
import { DrovrIntakeTimeout, drovrIntakeLayer } from "../src/drovr-intake.js";

const request: IntakeRequest = {
  challenge: "test-challenge",
  clientBucket: { ipHash: "a".repeat(64), uaHash: "b".repeat(64) },
  email: "fictional@example.test",
  submissionId: "test-submission",
};

const settings = {
  credential: Option.some(Redacted.make("test-credential")),
  url: Option.some("https://intake.test/submit"),
};

const slowDrovr = (latency: Duration.Duration) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((outgoing) =>
      Effect.sleep(latency).pipe(
        Effect.as(
          HttpClientResponse.fromWeb(
            outgoing,
            Response.json({ accepted: true }, { status: 202 })
          )
        )
      )
    )
  );

it.effect.prop(
  "browser and agent intake give up on drovr at the one configured timeout",
  {
    latencyMillis: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 90_000, minimum: 0 }))
    ),
    timeoutSeconds: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: 1 }))
    ),
  },
  ({ latencyMillis, timeoutSeconds }) =>
    Effect.gen(function* oneTimeout() {
      const timeout = Duration.seconds(timeoutSeconds);

      const latency = Duration.millis(
        latencyMillis === timeoutSeconds * 1000
          ? latencyMillis + 1
          : latencyMillis
      );

      const intake = yield* Layer.build(
        drovrAgentIntakeLayer(settings).pipe(
          Layer.provide(drovrIntakeLayer(settings)),
          Layer.provide(slowDrovr(latency)),
          Layer.provide(Layer.succeed(DrovrIntakeTimeout, timeout)),
          Layer.provide(Logger.layer([]))
        )
      );

      const browser = yield* Effect.forkChild(
        SubscriberIntake.use((service) => service.submit(request)).pipe(
          Effect.provideContext(intake)
        )
      );

      const agent = yield* Effect.forkChild(
        SubscriberIntake.use((service) =>
          service.agent === undefined
            ? Effect.die(new Error("missing agent adapter"))
            : service.agent.submit({
                ...request,
                agentRef: "test-agent",
                source: "agent",
              })
        ).pipe(Effect.provideContext(intake))
      );

      yield* TestClock.adjust(
        Duration.sum(Duration.max(latency, timeout), Duration.seconds(1))
      );

      const expected = Duration.isLessThan(latency, timeout)
        ? { kind: "accepted" }
        : { afterSeconds: 0, kind: "retry" };

      expect(yield* Fiber.join(browser)).toEqual(expected);
      expect(yield* Fiber.join(agent)).toEqual(expected);
    }),
  { arbitrary: { runs: 100 } }
);
