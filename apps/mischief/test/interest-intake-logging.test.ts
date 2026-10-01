import { expect, it } from "@effect/vitest";
import {
  InterestDirectory,
  InterestGate,
  InterestMode,
  InterestRequest,
  InterestTokens,
  SubscriberIntake,
  recordingMailerLayer,
} from "@rat-stack/core/interest";
import { Effect, Layer, Logger, Redacted } from "effect";

import { registerInterest } from "../src/interest/handlers.js";

it.effect(
  "logs only retry seconds when the intake wait or retry budget is exhausted",
  () =>
    Effect.gen(function* busyLog() {
      for (const retryAfterSeconds of [600, 0]) {
        const logs: unknown[] = [];
        let calls = 0;

        const failure = yield* registerInterest
          .handler({
            email: "busy@example.test",
            shieldToken: "private-challenge",
          })
          .pipe(
            Effect.flip,
            Effect.provide(
              Layer.mergeAll(
                InterestDirectory.memory,
                InterestMode.layer("drovr"),
                InterestTokens.layer(Redacted.make("test-secret")),
                recordingMailerLayer,
                Layer.succeed(InterestRequest, {
                  ip: "203.0.113.7",
                  origin: "https://example.test",
                  userAgent: "test-agent",
                }),
                Layer.succeed(InterestGate, {
                  allow: () => Effect.succeed(true),
                }),
                Layer.succeed(SubscriberIntake, {
                  submit: () =>
                    Effect.sync(() => {
                      calls += 1;

                      return {
                        afterSeconds: retryAfterSeconds,
                        kind: "retry",
                      } as const;
                    }),
                }),
                Logger.layer([Logger.make(({ message }) => logs.push(message))])
              )
            )
          );

        expect(failure.message).toBe(
          "We couldn't verify that. Please try again."
        );
        expect(calls).toBe(retryAfterSeconds === 600 ? 1 : 3);
        expect(logs).toEqual([["drovr intake busy", { retryAfterSeconds }]]);
        expect(JSON.stringify(logs)).not.toContain("busy@example.test");
        expect(JSON.stringify(logs)).not.toContain("private-challenge");
      }
    })
);
