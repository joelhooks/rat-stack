import { describe, expect, it } from "@effect/vitest";
import { Clock, DateTime, Effect, Fiber, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import type {
  AgentIntakeRequest,
  IntakeResult,
} from "../src/interest-intake.js";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactSchema,
  JoinContactStore,
} from "../src/join-contact-store.js";
import { runJoinDelivery } from "../src/join-delivery-machine.js";
import { scriptedIntakeLayer } from "./fixtures/scripted-intake.js";

const Step = Schema.Struct({
  advance: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 86_401 })),
  afterSeconds: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 86_401 })
  ),
  outcome: Schema.Literals([
    "accepted",
    "unavailable",
    "budget",
    "invalid",
    "challenge",
    "timeout",
  ]),
});

const histories = Arbitrary.array(Arbitrary.schema(Step), {
  minLength: 1,
  maxLength: 12,
});

const replay = Effect.fnUntraced(function* replay(
  contact: typeof JoinContactSchema.Type,
  history: readonly (typeof Step.Type)[]
) {
  const contacts = yield* JoinContactStore;
  const start = yield* Clock.currentTimeMillis;
  const deadline = start + JOIN_CONTACT_RETENTION_MILLIS;
  const requests: AgentIntakeRequest[] = [];
  let elapsed = 0;
  let retryAt = 0;
  let alive = true;
  let firstDispatchAt: string | null = null;

  yield* contacts.save({
    ...contact,
    hold: false,
    pending: "delivery",
    retentionDeadlineAt: deadline,
    retryAt: 0,
    state: "ready",
  });

  for (const step of history) {
    yield* TestClock.adjust(step.advance * 1000);
    elapsed += step.advance * 1000;

    const shouldSubmit =
      alive && elapsed < JOIN_CONTACT_RETENTION_MILLIS && elapsed >= retryAt;

    if (shouldSubmit && firstDispatchAt === null) {
      firstDispatchAt = DateTime.formatIso(yield* DateTime.now);
    }

    const before = requests.length;

    const kind = {
      accepted: "accepted",
      unavailable: "retry",
      budget: "retry",
      invalid: "refused",
      challenge: "refused",
      timeout: "retry",
    } as const;

    const afterSeconds = step.outcome === "timeout" ? 0 : step.afterSeconds;

    const resultKind = kind[step.outcome];

    const outcome: IntakeResult =
      resultKind === "retry"
        ? { afterSeconds, kind: resultKind }
        : { kind: resultKind };

    const fiber = yield* runJoinDelivery({
      submissionId: contact.submissionId,
    }).pipe(
      Effect.provide(
        scriptedIntakeLayer({
          agent: {
            submit: (request) =>
              Effect.gen(function* submit() {
                requests.push(request);

                return yield* step.outcome === "timeout"
                  ? Effect.never
                  : Effect.succeed(outcome);
              }),
          },
        })
      ),
      Effect.forkScoped
    );

    yield* TestClock.adjust(0);

    if (shouldSubmit && step.outcome === "timeout") {
      const duration = Math.min(
        25_000,
        JOIN_CONTACT_RETENTION_MILLIS - elapsed
      );

      yield* TestClock.adjust(duration);
      elapsed += duration;
    }

    yield* Fiber.join(fiber);

    expect(requests.length - before).toBe(shouldSubmit ? 1 : 0);
    const handoff = yield* contacts.readHandoff(contact.submissionId);
    expect(handoff?.handedToDrovrAt).toBe(firstDispatchAt);
    expect(handoff?.handedToDrovr).toBe(firstDispatchAt !== null);

    if (shouldSubmit) {
      if (outcome.kind === "retry") {
        retryAt = elapsed + outcome.afterSeconds * 1000;
        alive = retryAt < JOIN_CONTACT_RETENTION_MILLIS;
      } else {
        alive = false;
      }
    }

    if (elapsed >= JOIN_CONTACT_RETENTION_MILLIS) {
      alive = false;
    }

    const stored = yield* contacts.read(contact.submissionId);
    expect(stored !== undefined).toBe(alive);

    if (stored !== undefined) {
      expect(stored.retentionDeadlineAt).toBe(deadline);

      if (shouldSubmit) {
        expect(stored.retryAt).toBe(start + retryAt);
      }
    }
  }

  for (const request of requests) {
    expect(request).toStrictEqual({
      agentRef: contact.agentRef,
      clientBucket: contact.clientBucket,
      email: contact.email,
      hold: false,
      score: contact.score,
      source: "agent",
      submissionId: contact.submissionId,
    });
  }
}, Effect.scoped);

describe("join delivery retention model", () => {
  it.effect.prop(
    "generated delivery results and clock advances preserve erasure, due times and submission identity",
    { contact: JoinContactSchema, history: histories },
    ({ contact, history }) =>
      replay(contact, history).pipe(Effect.provide(JoinContactStore.testLayer)),
    { arbitrary: { runs: 200 } }
  );

  it.effect.prop(
    "outages and Retry-After on either side of 24h cannot extend retention",
    {
      contact: JoinContactSchema,
      offset: Schema.Int.check(Schema.isBetween({ minimum: -2, maximum: 2 })),
      outcome: Schema.Literals([
        "accepted",
        "unavailable",
        "budget",
        "invalid",
        "challenge",
        "timeout",
      ]),
    },
    ({ contact, offset, outcome }) =>
      replay(contact, [
        { advance: 0, afterSeconds: 86_400 + offset, outcome: "unavailable" },
        { advance: 86_400 + offset, afterSeconds: 30, outcome },
        { advance: 4, afterSeconds: 0, outcome: "accepted" },
      ]).pipe(Effect.provide(JoinContactStore.testLayer)),
    { arbitrary: { runs: 100 } }
  );
});
