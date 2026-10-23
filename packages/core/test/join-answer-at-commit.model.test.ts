import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Redacted,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { IntakeRedeliver } from "../src/intake-redeliver.js";
import {
  AbuseScore,
  IntakeEvents,
  IntakeTicket,
  PAGE_TICKET_SOURCE,
} from "../src/intake.js";
import { InterestTokens, SubscriberIntake } from "../src/interest.js";
import type { AgentIntakeRequest, IntakeResult } from "../src/interest.js";
import {
  JoinContactStore,
  JoinRequest,
  JOIN_ANSWER,
  joinIntakeLayer,
  joinInterest,
} from "../src/join-interest.js";
import type { JoinContactState } from "../src/join-interest.js";

const DrovrOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("accepted") }),
  Schema.Struct({ kind: Schema.Literal("refused") }),
  Schema.Struct({
    afterSeconds: Schema.Int.check(
      Schema.isBetween({ maximum: 5, minimum: 0 })
    ),
    kind: Schema.Literal("retry"),
  }),
  Schema.Struct({ kind: Schema.Literal("defect") }),
]);

type DrovrOutcome = typeof DrovrOutcomeSchema.Type;

const AttemptSchema = Schema.Struct({
  latencySeconds: Schema.Int.check(
    Schema.isBetween({ maximum: 30, minimum: 0 })
  ),
  outcome: DrovrOutcomeSchema,
});

type Attempt = typeof AttemptSchema.Type;

const finalStateFor = {
  accepted: "accepted",
  refused: "refused",
  retry: "ready",
} as const satisfies Record<IntakeResult["kind"], JoinContactState>;

const settledBy = (attempts: readonly Attempt[], from: number) => {
  let cursor = from;

  for (let retries = 0; ; retries += 1) {
    const outcome: DrovrOutcome = attempts[cursor]?.outcome ?? {
      kind: "accepted",
    };

    cursor += 1;

    if (outcome.kind === "defect") {
      return { cursor, state: "ready" as const };
    }

    if (outcome.kind !== "retry" || outcome.afterSeconds > 3 || retries >= 2) {
      return { cursor, state: finalStateFor[outcome.kind] };
    }
  }
};

const card = {
  agentRef: "model-agent",
  answers: { building: "a workshop tool" },
  consent: { contact: true },
  email: "fictional@example.test",
} as const;

it.effect.prop(
  "join answers at commit before drovr is called, and waitUntil or the redelivery backstop settles the same submission id",
  {
    attempts: Arbitrary.array(Arbitrary.schema(AttemptSchema), {
      maxLength: 6,
      minLength: 1,
    }),
    backgroundDropped: Arbitrary.schema(Schema.Boolean),
  },
  ({ attempts, backgroundDropped }) =>
    Effect.gen(function* answerAtCommit() {
      const sent: AgentIntakeRequest[] = [];
      const afterResponse: Effect.Effect<void>[] = [];
      const drovrCalled = yield* Deferred.make<"drovr called first">();

      const drovr = Layer.succeed(SubscriberIntake, {
        agent: {
          enabled: true,
          submit: Effect.fnUntraced(function* slowDrovr(
            input: AgentIntakeRequest
          ) {
            const attempt = attempts[sent.length];
            sent.push(input);
            yield* Deferred.succeed(drovrCalled, "drovr called first");
            yield* Effect.sleep(Duration.seconds(attempt?.latencySeconds ?? 0));

            const outcome = attempt?.outcome ?? { kind: "accepted" };

            if (outcome.kind === "defect") {
              return yield* Effect.die("generated drovr defect");
            }

            return outcome;
          }),
        },
        submit: () => Effect.die("person intake must not run"),
      });

      const services = yield* Layer.build(
        Layer.mergeAll(joinIntakeLayer, IntakeRedeliver.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              IntakeTicket.testLayer,
              JoinContactStore.testLayer,
              InterestTokens.layer(Redacted.make("model-interest-secret")),
              NodeCrypto.layer,
              IntakeEvents.testLayer,
              AbuseScore.testLayer(),
              drovr
            )
          )
        )
      );

      const ticket = yield* IntakeTicket.use((tickets) =>
        tickets.mint(PAGE_TICKET_SOURCE)
      ).pipe(Effect.provideContext(services));

      const answer = yield* joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provideContext(services),
        Effect.provideService(JoinRequest, {
          afterResponse: (work) =>
            Effect.sync(() => {
              afterResponse.push(work);
            }),
          allow: () => Effect.succeed("allowed" as const),
          ip: "203.0.113.17",
          userAgent: "model-test",
        }),
        Effect.raceFirst(Deferred.await(drovrCalled))
      );

      expect(answer).not.toBe("drovr called first");

      if (answer === "drovr called first") {
        return;
      }

      expect(sent).toHaveLength(0);
      expect(answer.message).toBe(JOIN_ANSWER);

      const contacts = yield* JoinContactStore.pipe(
        Effect.provideContext(services)
      );

      expect((yield* contacts.read(answer.statusRef))?.state).toBe("ready");
      expect(afterResponse).toHaveLength(1);

      const background = backgroundDropped
        ? { cursor: 0, state: "ready" as const }
        : settledBy(attempts, 0);

      if (!backgroundDropped) {
        const work = yield* Effect.forkChild(Effect.all(afterResponse));
        yield* TestClock.adjust("10 minutes");
        yield* Fiber.join(work);
      }

      expect(sent).toHaveLength(background.cursor);
      expect((yield* contacts.read(answer.statusRef))?.state).toBe(
        background.state
      );

      if (background.state === "ready") {
        const backstop = settledBy(attempts, background.cursor);

        const redelivery = yield* IntakeRedeliver.use((service) =>
          service.redeliver({ submissionIds: [answer.statusRef] })
        ).pipe(Effect.provideContext(services), Effect.exit, Effect.forkChild);

        yield* TestClock.adjust("10 minutes");
        yield* Fiber.join(redelivery);

        expect(sent).toHaveLength(backstop.cursor);
        expect((yield* contacts.read(answer.statusRef))?.state).toBe(
          backstop.state
        );
      }

      expect(
        sent.every((input) => input.submissionId === answer.statusRef)
      ).toBe(true);
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 100 } }
);
