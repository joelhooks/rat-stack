import { expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { IntakeErasure } from "../src/intake-erase.js";
import { IntakeEventsUnavailable } from "../src/intake-events-unavailable.js";
import { ContactRefSchema, IntakeEvents } from "../src/intake-events.js";
import { IntakeSweep } from "../src/intake-sweep.js";
import { SubscriberIntake } from "../src/interest-intake.js";
import type { AgentIntakeRequest } from "../src/interest-intake.js";
import {
  JoinContactStore,
  withPending,
  withState,
} from "../src/join-contact-store.js";
import {
  deliveryStateFor,
  runJoinDelivery,
} from "../src/join-delivery-machine.js";

const AnswerSchema = Schema.Struct({
  latencySeconds: Schema.Int.check(
    Schema.isBetween({ maximum: 8, minimum: 0 })
  ),
  outcome: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("accepted") }),
    Schema.Struct({ kind: Schema.Literal("refused") }),
    Schema.Struct({
      afterSeconds: Schema.Int.check(
        Schema.isBetween({ maximum: 3, minimum: 0 })
      ),
      kind: Schema.Literal("retry"),
    }),
  ]),
});

const StepSchema = Schema.Union([
  Schema.Struct({ down: Schema.Boolean, kind: Schema.Literal("basin") }),
  Schema.Struct({ kind: Schema.Literal("erase") }),
  Schema.Struct({ kind: Schema.Literal("sweep") }),
  Schema.Struct({
    killAfterMillis: Schema.Int.check(
      Schema.isBetween({ maximum: 12_000, minimum: 0 })
    ),
    kind: Schema.Literal("killedDelivery"),
  }),
  Schema.Struct({
    basinDown: Schema.Boolean,
    eraseAfterMillis: Schema.Int.check(
      Schema.isBetween({ maximum: 3000, minimum: 0 })
    ),
    kind: Schema.Literal("eraseDuringDelivery"),
  }),
]);

const submissionId = "sweep-model-submission";

type Step = typeof StepSchema.Type;

type Answer = typeof AnswerSchema.Type;

interface Tracker {
  acceptedAt: number | undefined;
  eraseRequestedAt: number | undefined;
  readonly sent: AgentIntakeRequest[];
}

const settle = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* settleStep() {
    const fiber = yield* Effect.forkChild(effect);
    yield* TestClock.adjust("2 minutes");

    return yield* Fiber.join(fiber);
  });

const makeWorld = Effect.fnUntraced(function* makeWorld(
  answers: readonly Answer[],
  tracker: Tracker
) {
  const contactRef = yield* Schema.decodeEffect(ContactRefSchema)(
    "sweep-model-contact"
  );

  const basinDown = yield* Ref.make(false);
  const tombstones = yield* Ref.make(0);

  const events = Layer.succeed(IntakeEvents, {
    erase: () =>
      Effect.flatMap(Ref.get(basinDown), (down) =>
        down
          ? Effect.fail(new IntakeEventsUnavailable({}))
          : Ref.update(tombstones, (count) => count + 1)
      ),
    record: () => Effect.void,
  });

  const drovr = Layer.succeed(SubscriberIntake, {
    agent: {
      enabled: true,
      submit: Effect.fnUntraced(function* slowDrovr(input: AgentIntakeRequest) {
        const answer = answers[tracker.sent.length];
        tracker.sent.push(input);
        yield* Effect.sleep(
          Duration.millis((answer?.latencySeconds ?? 0) * 1000 + 1)
        );

        return answer?.outcome ?? ({ kind: "accepted" } as const);
      }),
    },
    submit: () => Effect.die("person intake must not run"),
  });

  const memory = yield* Layer.build(JoinContactStore.testLayer);
  const stored = yield* JoinContactStore.pipe(Effect.provideContext(memory));

  const guardedContacts = Layer.succeed(JoinContactStore, {
    ...stored,
    erase: (id) =>
      Effect.flatMap(Ref.get(tombstones), (written) =>
        written === 0
          ? Effect.die("contact removed before its event tombstone")
          : stored.erase(id)
      ),
  });

  const services = yield* Layer.build(
    Layer.mergeAll(IntakeSweep.layer, IntakeErasure.layer).pipe(
      Layer.provideMerge(Layer.mergeAll(guardedContacts, events, drovr))
    )
  );

  const contacts = yield* JoinContactStore.pipe(
    Effect.provideContext(services)
  );

  yield* contacts.save(
    withPending(
      withState(
        {
          agentRef: "sweep-agent",
          clientBucket: { ipHash: "ip", uaHash: "ua" },
          contactRef,
          email: "fictional@example.test",
          hold: false,
          score: 0,
          signals: [],
          state: "held",
          submissionId,
          ticket: "sweep-ticket",
        },
        "ready"
      ),
      "delivery"
    )
  );

  const erase = settle(
    IntakeErasure.use((erasure) => erasure.erase([submissionId])).pipe(
      Effect.provideContext(services)
    )
  );

  const sweep = settle(
    IntakeSweep.use((sweeper) => sweeper.sweep([submissionId])).pipe(
      Effect.provideContext(services)
    )
  );

  const background = runJoinDelivery({ submissionId }).pipe(
    Effect.flatMap((result) =>
      contacts.setState(submissionId, deliveryStateFor[result.kind])
    ),
    Effect.provideContext(services)
  );

  return { background, basinDown, contacts, erase, sweep, tombstones };
});

type World = Effect.Success<ReturnType<typeof makeWorld>>;

const deliveryInFlight = Effect.fnUntraced(function* deliveryInFlight(
  world: World,
  tracker: Tracker,
  step: Extract<Step, { kind: "eraseDuringDelivery" | "killedDelivery" }>
) {
  const pending = yield* world.contacts.read(submissionId);

  if (pending?.pending !== "delivery" || pending.state !== "ready") {
    return;
  }

  const fiber = yield* Effect.forkChild(world.background);

  if (step.kind === "killedDelivery") {
    yield* TestClock.adjust(Duration.millis(step.killAfterMillis));
    yield* Fiber.interrupt(fiber);

    return;
  }

  yield* TestClock.adjust(Duration.millis(step.eraseAfterMillis));
  yield* Ref.set(world.basinDown, step.basinDown);
  tracker.eraseRequestedAt ??= tracker.sent.length;
  yield* world.erase;
  yield* Fiber.join(fiber);
});

const runStep = Effect.fnUntraced(function* runStep(
  world: World,
  tracker: Tracker,
  step: Step
) {
  if (step.kind === "basin") {
    yield* Ref.set(world.basinDown, step.down);
  } else if (step.kind === "erase") {
    tracker.eraseRequestedAt ??= tracker.sent.length;
    yield* world.erase;
  } else if (step.kind === "sweep") {
    yield* world.sweep;
  } else {
    yield* deliveryInFlight(world, tracker, step);
  }
});

const expectStepInvariants = Effect.fnUntraced(function* expectStepInvariants(
  world: World,
  tracker: Tracker
) {
  const contact = yield* world.contacts.read(submissionId);

  if (contact?.state === "accepted") {
    tracker.acceptedAt ??= tracker.sent.length;
  }

  if (tracker.eraseRequestedAt !== undefined) {
    expect(contact === undefined || contact.pending === "erase").toBe(true);
  }

  expect(contact?.pending !== "delivery" || contact.state === "ready").toBe(
    true
  );
});

const expectRecovered = Effect.fnUntraced(function* expectRecovered(
  world: World,
  tracker: Tracker
) {
  yield* Ref.set(world.basinDown, false);
  const sentBeforeRecovery = tracker.sent.length;
  yield* world.sweep;

  const settled = yield* world.contacts.read(submissionId);

  if (tracker.eraseRequestedAt === undefined) {
    expect(settled?.pending).toBe(
      settled?.state === "ready" ? "delivery" : undefined
    );
    expect(
      settled !== undefined &&
        (settled.state !== "ready" || tracker.sent.length > sentBeforeRecovery)
    ).toBe(true);
  } else {
    expect(settled).toBeUndefined();
    expect(yield* Ref.get(world.tombstones)).toBeGreaterThan(0);
    expect(tracker.sent).toHaveLength(tracker.eraseRequestedAt);
  }

  expect(tracker.sent).toHaveLength(tracker.acceptedAt ?? tracker.sent.length);
  expect(
    tracker.sent.every((input) => input.submissionId === submissionId)
  ).toBe(true);
});

it.effect.prop(
  "the sweep finishes every pending delivery or erase; erase wins, tombstones land first, and nothing is sent after erase or acceptance",
  {
    answers: Arbitrary.array(Arbitrary.schema(AnswerSchema), { maxLength: 8 }),
    steps: Arbitrary.array(Arbitrary.schema(StepSchema), {
      maxLength: 10,
      minLength: 1,
    }),
  },
  ({ answers, steps }) =>
    Effect.gen(function* sweepModel() {
      const tracker: Tracker = {
        acceptedAt: undefined,
        eraseRequestedAt: undefined,
        sent: [],
      };

      const world = yield* makeWorld(answers, tracker);

      for (const step of steps) {
        yield* runStep(world, tracker, step);
        yield* expectStepInvariants(world, tracker);
      }

      yield* expectRecovered(world, tracker);
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 200 } }
);
