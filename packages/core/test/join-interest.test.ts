import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { IntakeRedeliver } from "../src/intake-redeliver.js";
import {
  AbuseScore,
  IntakeEvents,
  IntakeEventsTest,
  IntakeTicket,
  PAGE_TICKET_SOURCE,
  QuestionIdSchema,
} from "../src/intake.js";
import { InterestTokens } from "../src/interest.js";
import type { AgentIntakeRequest, IntakeResult } from "../src/interest.js";
import {
  JoinAnswers,
  JoinContactStore,
  JoinRequest,
  JOIN_ANSWER,
  JOIN_BUSY,
  JOIN_DELAYED,
  JOIN_NOT_OPEN,
  joinIntakeLayer,
  joinInterest,
  joinInterestContract,
} from "../src/join-interest.js";
import { scriptedIntakeEventsLayer } from "./fixtures/scripted-intake-events.js";
import {
  makeScriptedIntake,
  scriptedIntakeLayer,
} from "./fixtures/scripted-intake.js";

const Scenario = Schema.Struct({
  enabled: Schema.Boolean,
  eventsUp: Schema.Boolean,
  gate: Schema.Literals([
    "allowed",
    "ip_limited",
    "agent_limited",
    "unavailable",
  ]),
  hold: Schema.Boolean,
  share: Schema.Boolean,
  validIp: Schema.Boolean,
  validTicket: Schema.Boolean,
});

const base = Layer.mergeAll(
  IntakeTicket.testLayer,
  JoinContactStore.testLayer,
  InterestTokens.layer(Redacted.make("test-interest-secret")),
  NodeCrypto.layer
);

const card = {
  agentRef: "test-agent",
  answers: { building: "a workshop tool", leaveWith: "a working loop" },
  consent: { contact: true },
  email: "fictional@example.test",
  name: "Fake Applicant",
  x: "https://x.com/fake_applicant",
} as const;

const pendingAfterAnswer = (
  deferred: boolean,
  delivered: "accepted" | "refused" | "retry"
) => (deferred || delivered !== "retry" ? undefined : "delivery");

const isRetained = (eligible: boolean, hold: boolean, eventsUp: boolean) =>
  eligible && (hold || !eventsUp);

const expectedSavedState = (hold: boolean, eventsUp: boolean) =>
  eventsUp && !hold ? undefined : "held";

const expectOperatorRelease = Effect.fnUntraced(function* expectOperatorRelease(
  contacts: JoinContactStore["Service"],
  submissionId: string
) {
  if ((yield* contacts.read(submissionId)) === undefined) {
    return;
  }

  const released = yield* IntakeRedeliver.use((service) =>
    service.redeliver({ releaseHeld: true, submissionIds: [submissionId] })
  ).pipe(
    Effect.provide(
      IntakeRedeliver.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JoinContactStore, contacts),
            scriptedIntakeLayer({
              agent: {
                submit: (input) =>
                  Effect.sync(() => {
                    expect(input.hold).toBe(false);

                    return { kind: "accepted" } as const;
                  }),
              },
            })
          )
        )
      )
    )
  );

  expect(released.rows[0]?.outcome).toBe("accepted");
  expect(yield* contacts.read(submissionId)).toBeUndefined();
});

it.effect.prop(
  "only authorized submissions reach delivery; accepted contacts are erased and held or events-down contacts remain releasable",
  {
    answers: Arbitrary.schema(JoinAnswers),
    scenario: Arbitrary.schema(Scenario),
  },
  ({ answers, scenario }) =>
    Effect.gen(function* verifyGates() {
      const forwarded: AgentIntakeRequest[] = [];
      const saved: string[] = [];
      const savedRefs: string[] = [];
      const tickets = yield* IntakeTicket;
      const events = yield* IntakeEvents;
      const contacts = yield* JoinContactStore;
      const steps: string[] = [];

      const ticket = scenario.validTicket
        ? yield* tickets.mint(PAGE_TICKET_SOURCE)
        : "forged";

      const layer = joinIntakeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            base,
            AbuseScore.testLayer((input) => {
              steps.push("score");
              expect(input).not.toHaveProperty("email");
              expect(input).not.toHaveProperty("consent");
              expect(input.answers).toEqual(answers);

              return {
                hold: scenario.hold,
                score: scenario.hold ? 1 : 0,
                signals: [],
              };
            }),
            Layer.succeed(JoinContactStore, {
              ...contacts,
              save: (contact) => {
                saved.push(contact.submissionId);
                savedRefs.push(contact.contactRef);

                return contacts.save(contact);
              },
            }),
            Layer.succeed(IntakeTicket, {
              ...tickets,
              verify: (value, id) =>
                Effect.sync(() => steps.push("ticket")).pipe(
                  Effect.andThen(tickets.verify(value, id))
                ),
            }),
            scriptedIntakeEventsLayer({
              erase: events.erase,
              record: (statements) =>
                Effect.sync(() => steps.push("events")).pipe(
                  Effect.andThen(events.record(statements))
                ),
            }),
            scriptedIntakeLayer({
              agent: {
                enabled: scenario.enabled,
                submit: (input) =>
                  Effect.sync(() => {
                    forwarded.push(input);
                    steps.push("forward");

                    return { kind: "accepted" } as const;
                  }),
              },
            })
          )
        )
      );

      const result = yield* joinInterest
        .handler({
          ...card,
          answers,
          consent: { contact: true, share: scenario.share },
          ticket,
        })
        .pipe(
          Effect.provide(layer),
          Effect.provideService(JoinRequest, {
            afterResponse: (work) => work,
            allow: () =>
              Effect.sync(() => {
                steps.push("gate");

                return scenario.gate;
              }),
            ip: scenario.validIp ? "203.0.113.17" : undefined,
            userAgent: "property-test",
          })
        );

      const eligible =
        scenario.enabled &&
        scenario.gate === "allowed" &&
        scenario.validTicket &&
        scenario.validIp;

      const messageForGate = {
        agent_limited: JOIN_BUSY,
        allowed: JOIN_ANSWER,
        ip_limited: JOIN_BUSY,
        unavailable: JOIN_ANSWER,
      };

      expect(result.message).toBe(
        scenario.enabled ? messageForGate[scenario.gate] : JOIN_NOT_OPEN
      );
      expect(new Set(saved).size).toBe(eligible ? 1 : 0);

      if (result.message === JOIN_BUSY) {
        expect(result.statusRef).toBe("unavailable");
      }

      expect(result.statusRef).not.toContain(card.email);
      expect(forwarded.length).toBe(
        eligible && !scenario.hold && scenario.eventsUp ? 1 : 0
      );
      const contact = yield* contacts.read(result.statusRef);
      expect(contact !== undefined).toBe(
        isRetained(eligible, scenario.hold, scenario.eventsUp)
      );

      if (eligible) {
        expect(steps.slice(0, 3)).toEqual(["gate", "ticket", "score"]);
        expect(contact?.state).toBe(
          expectedSavedState(scenario.hold, scenario.eventsUp)
        );

        if (scenario.eventsUp) {
          const recorded = yield* IntakeEventsTest.use(
            (test) => test.statements
          );

          expect(JSON.stringify(recorded)).not.toContain(card.email);
          expect(
            recorded.find((statement) => statement.verb === "started")?.result
          ).toEqual({ name: card.name, x: card.x });
          expect(
            recorded.find(
              (statement) => statement.object === "tokenmaxx/consents/share"
            )?.result
          ).toBe(scenario.share);
          expect(
            recorded.every(
              (statement) =>
                statement.actor === savedRefs[0] &&
                statement.context.submissionId === result.statusRef
            )
          ).toBe(true);
          expect(
            Object.fromEntries(
              recorded
                .filter((statement) => statement.verb === "answered")
                .map((statement) => [
                  statement.object.slice("tokenmaxx/questions/".length),
                  statement.result,
                ])
            )
          ).toEqual(answers);
          expect(
            recorded.every((statement) =>
              Schema.is(Schema.String.check(Schema.isUUID(7)))(statement.id)
            )
          ).toBe(true);
        }
      }

      const [payload] = forwarded;

      if (payload !== undefined) {
        expect(Object.keys(payload).toSorted()).toEqual([
          "agentRef",
          "clientBucket",
          "email",
          "hold",
          "score",
          "source",
          "submissionId",
        ]);
        expect(payload).not.toHaveProperty("name");
        expect(payload).not.toHaveProperty("x");
        expect(payload).not.toHaveProperty("answers");
        expect(payload).not.toHaveProperty("consent");
        expect(payload).not.toHaveProperty("challenge");
        expect(payload.source).toBe("agent");
        expect(payload.hold).toBe(false);
        expect(payload.clientBucket.ipHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(payload.clientBucket.uaHash).toMatch(/^[a-f0-9]{64}$/u);
      }

      yield* expectOperatorRelease(contacts, result.statusRef);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          base,
          IntakeEvents.testLayer,
          scenario.eventsUp ? Layer.empty : IntakeEvents.unavailableTestLayer
        )
      )
    )
);

const WaitFreeDeliveryResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("accepted") }),
  Schema.Struct({ kind: Schema.Literal("refused") }),
  Schema.Struct({
    afterSeconds: Schema.Literals([0, 4, 60]),
    kind: Schema.Literal("retry"),
  }),
]);

const scorerVerdict = (
  scorerUnavailable: boolean,
  realReason: string,
  softSignals: readonly string[],
  highScore: number
) => ({
  hold: scorerUnavailable || realReason !== "none",
  score: Math.max(
    scorerUnavailable ? 1 : 0,
    realReason === "none" ? 0 : highScore
  ),
  signals: [
    ...softSignals,
    ...(scorerUnavailable ? ["scorer_unavailable"] : []),
    ...(realReason === "none" ? [] : [realReason]),
  ],
});

it.effect.prop(
  "only scorer-only holds return delayed; real holds win; drovr outcomes settle the contact, not the answer",
  {
    delivery: Arbitrary.schema(WaitFreeDeliveryResult),
    highScore: Arbitrary.schema(
      Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0.8 }))
    ),
    realReason: Arbitrary.schema(
      Schema.Literals([
        "none",
        "answer_junk",
        "answer_overlong",
        "jev_flagged",
        "unknown_hold",
      ])
    ),
    scorerUnavailable: Arbitrary.schema(Schema.Boolean),
    softSignals: Arbitrary.array(
      Arbitrary.schema(
        Schema.Literals([
          "ticket_instant",
          "no_answers",
          "jev_off",
          "jev_clear",
        ])
      ),
      { maxLength: 4 }
    ),
  },
  ({ delivery, highScore, realReason, scorerUnavailable, softSignals }) =>
    Effect.gen(function* verifyDeliveryAnswer() {
      const realHold = realReason !== "none";
      const scorerOnly = scorerUnavailable && !realHold;

      const verdict = scorerVerdict(
        scorerUnavailable,
        realReason,
        softSignals,
        highScore
      );

      const sent: string[] = [];
      const tickets = yield* IntakeTicket;
      const contacts = yield* JoinContactStore;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);
      const states: string[] = [];
      const submissionIds: string[] = [];

      const layer = joinIntakeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            base,
            IntakeEvents.testLayer,
            Layer.succeed(IntakeTicket, tickets),
            Layer.succeed(JoinContactStore, {
              ...contacts,
              save: (contact) => {
                submissionIds.push(contact.submissionId);

                return contacts.save(contact);
              },
              setState: (id, state) => {
                states.push(state);

                return contacts.setState(id, state);
              },
            }),
            AbuseScore.testLayer(verdict),
            scriptedIntakeLayer({
              agent: {
                submit: (input) =>
                  Effect.sync(() => {
                    sent.push(input.submissionId);

                    return delivery;
                  }),
              },
            })
          )
        )
      );

      const result = yield* joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provide(layer),
        Effect.provideService(JoinRequest, {
          afterResponse: (work) => work,
          allow: () => Effect.succeed("allowed" as const),
          ip: "203.0.113.17",
          userAgent: "property-test",
        })
      );

      const delayed = scorerOnly;
      expect(result.message).toBe(delayed ? JOIN_DELAYED : JOIN_ANSWER);
      expect(Schema.is(joinInterestContract.output)(result)).toBe(true);
      const [submissionId] = submissionIds;
      expect(submissionId).toBeDefined();
      const contact = yield* contacts.read(submissionId ?? "missing");

      const deliveredState = {
        accepted: "accepted",
        refused: "refused",
        retry: "ready",
      };

      const retained = realHold || scorerOnly || delivery.kind === "retry";

      if (retained) {
        expect(contact).toMatchObject({
          state: realHold ? "held" : "ready",
          hold: realHold,
          signals: verdict.signals,
          email: card.email,
        });
      } else {
        expect(contact).toBeUndefined();
      }

      expect(result.statusRef).toBe(delayed ? "unavailable" : submissionId);
      const deferredStates = scorerOnly ? ["ready"] : [];
      expect(states).toEqual(
        realHold || scorerOnly
          ? deferredStates
          : [deliveredState[delivery.kind]]
      );
      expect(contact?.pending).toBe(
        pendingAfterAnswer(realHold || scorerOnly, delivery.kind)
      );

      expect(sent).toHaveLength(realHold || scorerOnly ? 0 : 1);
      expect(sent.every((id) => id === submissionId)).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(base)),
  { arbitrary: { runs: 100 } }
);

it.effect.prop(
  "accepts optional answers up to the public limit and rejects longer answers for every question",
  {
    question: Arbitrary.schema(QuestionIdSchema),
    text: Arbitrary.schema(Schema.String),
  },
  ({ question, text }) =>
    Effect.gen(function* validateAnswerLimit() {
      const bounded = text.slice(0, 2000);
      const answers = { [question]: bounded };
      expect(yield* Schema.decodeEffect(JoinAnswers)(answers)).toEqual(answers);
      expect(Schema.is(JoinAnswers)({ [question]: "a".repeat(2000) })).toBe(
        true
      );
      expect(Schema.is(JoinAnswers)({ [question]: "a".repeat(2001) })).toBe(
        false
      );
      expect(yield* Schema.decodeEffect(JoinAnswers)({})).toEqual({});
    })
);

const crashDelay = Schema.Int.check(
  Schema.isBetween({ maximum: 3, minimum: 0 })
);

it.effect.prop(
  "a delivery crash leaves admitted contacts ready for redrive, never refused or accepted",
  { delay: crashDelay },
  ({ delay }) =>
    Effect.gen(function* crashPreservesReadyContact() {
      const sent: AgentIntakeRequest[] = [];
      const tickets = yield* IntakeTicket;
      const contacts = yield* JoinContactStore;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);
      const submitting = yield* Deferred.make<boolean>();
      const states: string[] = [];

      const layer = joinIntakeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            base,
            IntakeEvents.testLayer,
            Layer.succeed(IntakeTicket, tickets),
            Layer.succeed(JoinContactStore, {
              ...contacts,
              setState: (id, state) =>
                Effect.sync(() => states.push(state)).pipe(
                  Effect.andThen(contacts.setState(id, state))
                ),
            }),
            AbuseScore.testLayer(),
            scriptedIntakeLayer({
              agent: {
                submit: Effect.fn("crashingIntake")(function* crashingIntake(
                  input: AgentIntakeRequest
                ) {
                  sent.push(input);
                  yield* Deferred.succeed(submitting, true);
                  yield* Effect.sleep(`${delay} seconds`);

                  return yield* Effect.die("generated seam delivery crash");
                }),
              },
            })
          )
        )
      );

      const fiber = yield* joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provide(layer),
        Effect.provideService(JoinRequest, {
          afterResponse: (work) => work,
          allow: () => Effect.succeed("allowed" as const),
          ip: "203.0.113.17",
          userAgent: "property-test",
        }),
        Effect.forkScoped
      );

      yield* Deferred.await(submitting);
      yield* TestClock.adjust("6 seconds");
      const answer = yield* Fiber.join(fiber);
      expect(answer.message).toBe(JOIN_ANSWER);
      expect(sent).toHaveLength(1);
      const contact = yield* contacts.read(answer.statusRef);
      expect(contact?.state).toBe("ready");
      expect(states).not.toContain("refused");
      expect(states).not.toContain("accepted");
      expect(
        sent.every((request) => request.submissionId === answer.statusRef)
      ).toBe(true);
      yield* TestClock.adjust("1 day");
      expect(sent).toHaveLength(1);
      expect((yield* contacts.read(answer.statusRef))?.state).toBe("ready");
    }).pipe(Effect.scoped, Effect.provide(base)),
  { arbitrary: { runs: 100 } }
);

const Response = Schema.Literals(["accepted", "refused", "retry"]);

const responses = Arbitrary.array(Arbitrary.schema(Response), {
  maxLength: 8,
  minLength: 1,
});

it.effect.prop(
  "one ticket admits one submission and every bounded replay preserves its submission id",
  { responses },
  ({ responses: generated }) =>
    Effect.gen(function* replaySubmission() {
      const tickets = yield* IntakeTicket;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);

      const intake = yield* makeScriptedIntake({
        agent: {
          submit: (_input, index) => {
            const kind = generated[index] ?? "refused";

            return Effect.succeed<IntakeResult>(
              kind === "retry" ? { afterSeconds: 0, kind } : { kind }
            );
          },
        },
      });

      const layer = joinIntakeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            base,
            IntakeEvents.testLayer,
            Layer.succeed(IntakeTicket, tickets),
            AbuseScore.testLayer(),
            intake.layer
          )
        )
      );

      const submit = joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provide(layer),
        Effect.provideService(JoinRequest, {
          afterResponse: (work) => work,
          allow: () => Effect.succeed("allowed" as const),
          ip: "203.0.113.17",
          userAgent: "property-test",
        })
      );

      const first = yield* submit;

      const expectedAttempts = 1;
      const sent = yield* intake.agentCalls;

      expect(sent.length).toBe(expectedAttempts);
      expect(
        sent.every((input) => input.submissionId === sent[0]?.submissionId)
      ).toBe(true);
      expect(
        sent.every(
          (input) => input.clientBucket.ipHash === sent[0]?.clientBucket.ipHash
        )
      ).toBe(true);
      const second = yield* submit;
      expect(first.message).toBe(JOIN_ANSWER);
      expect(second.message).toBe(JOIN_ANSWER);
      expect(second.statusRef).not.toBe(first.statusRef);
      expect(yield* intake.agentCalls).toHaveLength(expectedAttempts);
    }).pipe(Effect.provide(base))
);

it.effect(
  "missing share permission records false and contact consent is enforced by the contract",
  () =>
    Effect.gen(function* consentDefaults() {
      const tickets = yield* IntakeTicket;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);

      const layer = joinIntakeLayer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            base,
            Layer.succeed(IntakeTicket, tickets),
            AbuseScore.testLayer(),
            IntakeEvents.testLayer,
            scriptedIntakeLayer({
              agent: {
                submit: () => Effect.succeed({ kind: "accepted" } as const),
              },
            })
          )
        )
      );

      const services = yield* Layer.build(layer);
      yield* joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provideContext(services),
        Effect.provideService(JoinRequest, {
          afterResponse: (work) => work,
          allow: () => Effect.succeed("allowed" as const),
          ip: "203.0.113.17",
          userAgent: "test",
        })
      );

      const events = yield* IntakeEventsTest.use(
        (test) => test.statements
      ).pipe(Effect.provideContext(services));

      expect(
        events.find((event) => event.object === "tokenmaxx/consents/share")
          ?.result
      ).toBe(false);
      expect(
        Schema.is(joinInterestContract.input)({
          ...card,
          consent: { contact: false },
          ticket,
        })
      ).toBe(false);
      expect(
        Schema.is(joinInterestContract.input)({
          ...card,
          answers: { building: "a".repeat(2001) },
          ticket,
        })
      ).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(base))
);
