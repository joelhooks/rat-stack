import { expect, it } from "@effect/vitest";
import { FeedbackPoll, LearnUnauthenticated } from "@rat-stack/core/learn";
import type { FeedbackDevice } from "@rat-stack/core/learn";
import { createEffectActor, join } from "@xstate/effect";
import { Clock, Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { FeedbackAuthor } from "../src/feedback-author.js";
import {
  feedbackCredentialMachine,
  feedbackDeviceMachine,
  feedbackPerson,
} from "../src/feedback-machine.js";

const Command = Schema.Literals([
  "approve",
  "deny",
  "poll",
  "use",
  "wrong-scope",
  "wait",
  "expire",
]);

const histories = Arbitrary.array(Arbitrary.schema(Command), { maxLength: 40 });

const credentialState = (
  issued: boolean,
  status: "pending" | "approved" | "denied",
  now: number,
  deadline: number,
  command: typeof Command.Type
) => {
  if (!issued || status !== "approved" || command !== "use") {
    return "unauthenticated";
  }

  return now >= deadline ? "expired" : "active";
};

const observePoll = Effect.fn("observePoll")(function* observePoll(
  deviceCode: string
) {
  const actor = yield* createEffectActor(feedbackDeviceMachine, {
    input: { deviceCode },
  });

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine failures must fail the model check.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  return {
    result: yield* Schema.decodeUnknownEffect(FeedbackPoll)(
      outcome.result
    ).pipe(Effect.orDie),
    state: actor.getSnapshot().value,
  };
}, Effect.scoped);

const observeCredential = Effect.fn("observeCredential")(
  function* observeCredential(token: string, capability: string) {
    const actor = yield* createEffectActor(feedbackCredentialMachine, {
      input: { capability, token },
    });

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine failures must fail the model check.
    yield* join(actor).pipe(Effect.orDie);

    return actor.getSnapshot().value;
  },
  Effect.scoped
);

it.effect.prop(
  "generated device and credential histories preserve approval, expiry, denial, polling cadence, and feedback-only authority",
  { history: histories },
  ({ history }) =>
    Effect.gen(function* lifecycleModel() {
      let providerStatus: "pending" | "approved" | "denied" = "pending";
      let lastPolledAt: number | undefined;
      let issuances = 0;
      const deadline = 30_000;
      const interval = 5000;
      const token = "test-feedback-credential";

      const author = FeedbackAuthor.of({
        inspectCredential: (candidate, capability) =>
          Effect.gen(function* providerCredential() {
            if (
              candidate !== token ||
              capability !== "learnFeedback" ||
              providerStatus !== "approved"
            ) {
              return { state: "unauthenticated" } as const;
            }

            const now = yield* Clock.currentTimeMillis;

            return now >= deadline
              ? ({ state: "expired" } as const)
              : ({ personId: "person", state: "active" } as const);
          }),
        inspectDevice: () =>
          Effect.gen(function* observeDevice() {
            const now = yield* Clock.currentTimeMillis;

            if (now >= deadline) {
              return { interval: 5, state: "expired" } as const;
            }

            if (providerStatus === "denied") {
              return { interval: 5, state: "denied" } as const;
            }

            if (lastPolledAt !== undefined && now - lastPolledAt < interval) {
              return { interval: 5, state: "polled-too-fast" } as const;
            }

            lastPolledAt = now;

            return providerStatus === "approved"
              ? ({
                  grant: {
                    expiresAt: deadline,
                    id: "grant",
                    personId: "person",
                  },
                  state: "approved",
                } as const)
              : ({ interval: 5, state: "pending" } as const);
          }),
        issue: (grant) =>
          Effect.sync(() => {
            expect(grant).toStrictEqual({
              expiresAt: deadline,
              id: "grant",
              personId: "person",
            });
            issuances += 1;

            return token;
          }),
        request: Effect.succeed({
          deviceCode: "device",
          expiresIn: 30,
          interval: 5,
          userCode: "CODE1234",
          verificationUrl: "https://example.com/learn/approve",
        }),
        save: () => Effect.succeed({ id: "feedback" }),
      });

      let expectedStatus: "pending" | "approved" | "denied" = "pending";
      let modelTime = 0;
      let modelPollTime: number | undefined;
      let issued = false;
      let expectedIssuances = 0;

      const sequence: readonly (typeof Command.Type)[] = [
        "poll",
        ...history,
        "approve",
        "poll",
        "wait",
        "poll",
        "use",
        "wrong-scope",
        "expire",
        "use",
        "poll",
      ];

      for (const command of sequence) {
        if (command === "approve" || command === "deny") {
          if (modelTime < deadline && expectedStatus === "pending") {
            expectedStatus = command === "approve" ? "approved" : "denied";
            providerStatus = expectedStatus;
          }
        } else if (command === "wait" || command === "expire") {
          const amount = command === "wait" ? interval : deadline;
          modelTime += amount;
          yield* TestClock.adjust(amount);
        } else if (command === "poll") {
          let expected: (typeof FeedbackDevice.Type)["state"];

          if (modelTime >= deadline) {
            expected = "expired";
          } else if (expectedStatus === "denied") {
            expected = "denied";
          } else if (
            modelPollTime !== undefined &&
            modelTime - modelPollTime < interval
          ) {
            expected = "polled-too-fast";
          } else {
            modelPollTime = modelTime;
            expected = expectedStatus;
          }

          const before = issuances;

          const observation = yield* observePoll("device").pipe(
            Effect.provideService(FeedbackAuthor, author)
          );

          const { result } = observation;

          expect(observation.state).toBe(
            expected === "approved" ? "issued" : expected
          );
          expect(result.state).toBe(expected);

          if (result.state === "approved") {
            expect(result.token).toBe(token);
            expect(result.expiresAt).toBe(deadline);
            issued = true;
            expectedIssuances += 1;
          } else {
            expect("token" in result).toBe(false);
            expect(issuances).toBe(before);
          }
        } else {
          const capability = command === "use" ? "learnFeedback" : "execute";

          const candidate = issued ? token : "not-issued";

          const call = feedbackPerson(candidate, capability).pipe(
            Effect.provideService(FeedbackAuthor, author)
          );

          const expected = credentialState(
            issued,
            expectedStatus,
            modelTime,
            deadline,
            command
          );

          expect(
            yield* observeCredential(candidate, capability).pipe(
              Effect.provideService(FeedbackAuthor, author)
            )
          ).toBe(expected);

          if (expected === "active") {
            expect(yield* call).toBe("person");
          } else {
            expect(yield* Effect.flip(call)).toBeInstanceOf(
              LearnUnauthenticated
            );
          }
        }

        expect(issuances).toBe(expectedIssuances);
      }
    })
);
