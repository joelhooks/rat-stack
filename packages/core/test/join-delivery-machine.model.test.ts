import { describe, expect, it } from "@effect/vitest";
import { Cause, Clock, Effect, Exit, Fiber, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import type {
  AgentIntakeRequest,
  IntakeResult,
} from "../src/interest-intake.js";
import { SubscriberIntake } from "../src/interest-intake.js";
import {
  JoinContactSchema,
  JoinContactStore,
} from "../src/join-contact-store.js";
import { runJoinDelivery } from "../src/join-delivery-machine.js";

const Outcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("accepted") }),
  Schema.Struct({ kind: Schema.Literal("refused") }),
  Schema.Struct({
    afterSeconds: Schema.Int.check(
      Schema.isBetween({ maximum: 10, minimum: 0 })
    ),
    kind: Schema.Literal("retry"),
  }),
  Schema.Struct({ kind: Schema.Literal("defect") }),
]);

const ShortDelay = Schema.Int.check(
  Schema.isBetween({ maximum: 3, minimum: 0 })
);

const crashPrefixes = Arbitrary.array(Arbitrary.schema(ShortDelay), {
  maxLength: 2,
});

const Scenario = Schema.Struct({
  agentPresent: Schema.Boolean,
  contact: JoinContactSchema,
  contactPresent: Schema.Boolean,
});

const histories = Arbitrary.array(Arbitrary.schema(Outcome), {
  maxLength: 8,
  minLength: 3,
});

type DeliveryOutcome = typeof Outcome.Type;

type DeliveryScenario = typeof Scenario.Type;

const modelDelivery = (
  scenario: DeliveryScenario,
  history: readonly DeliveryOutcome[]
) => {
  const times: number[] = [];
  let elapsed = 0;
  let output: IntakeResult = { kind: "refused" };

  if (
    !scenario.contactPresent ||
    scenario.contact.state === "held" ||
    scenario.contact.hold ||
    !scenario.agentPresent
  ) {
    return { outcome: { kind: "settled", output } as const, reads: 1, times };
  }

  for (const outcome of history.slice(0, 3)) {
    times.push(elapsed);

    if (outcome.kind === "defect") {
      return {
        outcome: { kind: "crashed" } as const,
        reads: times.length,
        times,
      };
    }

    output = outcome;

    if (
      outcome.kind !== "retry" ||
      outcome.afterSeconds > 3 ||
      times.length === 3
    ) {
      break;
    }

    elapsed += outcome.afterSeconds * 1000;
  }

  return {
    outcome: { kind: "settled", output } as const,
    reads: times.length,
    times,
  };
};

const replayDelivery = Effect.fn("replayDelivery")(function* replayDelivery(
  scenario: DeliveryScenario,
  history: readonly DeliveryOutcome[]
) {
  const expected = modelDelivery(scenario, history);
  const reads: string[] = [];
  const requests: AgentIntakeRequest[] = [];
  const times: number[] = [];
  const start = yield* Clock.currentTimeMillis;

  const submit = Effect.fn("submitDelivery")(function* submitDelivery(
    request: AgentIntakeRequest
  ) {
    const outcome = history[requests.length];
    requests.push(request);
    times.push((yield* Clock.currentTimeMillis) - start);

    if (outcome === undefined) {
      return yield* Effect.die("delivery exceeded generated history");
    }

    if (outcome.kind === "defect") {
      return yield* Effect.die("generated delivery defect");
    }

    return outcome;
  });

  const personIntake = {
    submit: () => Effect.die("person intake must not run"),
  };

  const intake = SubscriberIntake.of(
    scenario.agentPresent
      ? { ...personIntake, agent: { enabled: true, submit } }
      : personIntake
  );

  const contacts = JoinContactStore.of({
    erase: () => Effect.die("delivery must not erase contacts"),
    read: (id) =>
      Effect.sync(() => {
        reads.push(id);

        return scenario.contactPresent ? scenario.contact : undefined;
      }),
    save: () => Effect.die("delivery must not save contacts"),
    setState: () => Effect.die("delivery must not change contact state"),
  });

  const fiber = yield* runJoinDelivery({
    submissionId: scenario.contact.submissionId,
  }).pipe(
    Effect.provideService(SubscriberIntake, intake),
    Effect.provideService(JoinContactStore, contacts),
    Effect.exit,
    Effect.forkScoped
  );

  yield* TestClock.adjust(0);

  for (let millis = 0; millis <= 6001; millis += 1000) {
    expect(times).toStrictEqual(
      expected.times.filter((time) => time <= millis)
    );
    yield* TestClock.adjust(999);
    expect(times).toStrictEqual(
      expected.times.filter((time) => time <= millis + 999)
    );
    yield* TestClock.adjust(1);
  }

  const exit = yield* Fiber.join(fiber);

  if (expected.outcome.kind === "crashed") {
    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe("generated delivery defect");
    }
  } else {
    expect(exit).toStrictEqual(Exit.succeed(expected.outcome.output));
  }

  expect(requests).toHaveLength(expected.times.length);
  expect(requests.length).toBeLessThanOrEqual(3);
  expect(reads).toStrictEqual(
    Array.from({ length: expected.reads }, () => scenario.contact.submissionId)
  );

  for (const request of requests) {
    expect(request).toStrictEqual({
      agentRef: scenario.contact.agentRef,
      clientBucket: scenario.contact.clientBucket,
      email: scenario.contact.email,
      hold: scenario.contact.hold,
      score: scenario.contact.score,
      signals: scenario.contact.signals,
      source: "agent",
      submissionId: scenario.contact.submissionId,
      ticket: scenario.contact.ticket,
    });
  }

  yield* TestClock.adjust("1 day");
  expect(times).toStrictEqual(expected.times);

  return exit;
}, Effect.scoped);

describe("join delivery lifecycle contract", () => {
  it.effect.prop(
    "short retries use their own delays and stop after three submissions",
    {
      contact: JoinContactSchema,
      first: ShortDelay,
      second: ShortDelay,
      third: ShortDelay,
    },
    ({ first, second, third, contact }) =>
      replayDelivery(
        {
          agentPresent: true,
          contact: { ...contact, hold: false, state: "ready" },
          contactPresent: true,
        },
        [
          { afterSeconds: first, kind: "retry" },
          { afterSeconds: second, kind: "retry" },
          { afterSeconds: third, kind: "retry" },
          { kind: "accepted" },
        ]
      ),
    { arbitrary: { runs: 100 } }
  );

  it.effect.prop(
    "a crash at any attempt propagates as a defect and stops delivery",
    { contact: JoinContactSchema, prefix: crashPrefixes },
    ({ contact, prefix }) =>
      replayDelivery(
        {
          agentPresent: true,
          contact: { ...contact, hold: false, state: "ready" },
          contactPresent: true,
        },
        [
          ...prefix.map((afterSeconds): DeliveryOutcome => ({
            afterSeconds,
            kind: "retry",
          })),
          { kind: "defect" },
          { kind: "accepted" },
        ]
      ),
    { arbitrary: { runs: 100 } }
  );
  it.effect.prop(
    "generated histories preserve submission bounds, deadlines and final results",
    { history: histories, scenario: Scenario },
    ({ history, scenario }) => replayDelivery(scenario, history),
    { arbitrary: { runs: 200 } }
  );

  it.effect.prop(
    "eligible contacts exercise retry and defect histories",
    { contact: JoinContactSchema, history: histories },
    ({ history, contact }) =>
      replayDelivery(
        {
          agentPresent: true,
          contact: { ...contact, hold: false, state: "ready" },
          contactPresent: true,
        },
        history
      ),
    { arbitrary: { runs: 200 } }
  );
});
