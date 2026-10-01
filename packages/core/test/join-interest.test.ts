import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import {
  AbuseScore,
  IntakeEvents,
  IntakeEventsTest,
  IntakeTicket,
  PAGE_TICKET_SOURCE,
} from "../src/intake.js";
import { InterestTokens, SubscriberIntake } from "../src/interest.js";
import type { AgentIntakeRequest, IntakeResult } from "../src/interest.js";
import {
  JoinContactStore,
  JoinRequest,
  JOIN_ANSWER,
  JOIN_NOT_OPEN,
  joinIntakeLayer,
  joinInterest,
  joinInterestContract,
} from "../src/join-interest.js";

const Scenario = Schema.Struct({
  allowed: Schema.Boolean,
  enabled: Schema.Boolean,
  eventsUp: Schema.Boolean,
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
} as const;

it.effect.prop(
  "only authorized clean recorded submissions leave the mapping; every response hides disposition",
  { scenario: Arbitrary.schema(Scenario) },
  ({ scenario }) =>
    Effect.gen(function* verifyGates() {
      const forwarded: AgentIntakeRequest[] = [];
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

              return {
                hold: scenario.hold,
                score: scenario.hold ? 1 : 0,
                signals: [],
              };
            }),
            Layer.succeed(JoinContactStore, contacts),
            Layer.succeed(IntakeTicket, {
              ...tickets,
              verify: (value, id) =>
                Effect.sync(() => steps.push("ticket")).pipe(
                  Effect.andThen(tickets.verify(value, id))
                ),
            }),
            Layer.succeed(IntakeEvents, {
              erase: events.erase,
              record: (statements) =>
                Effect.sync(() => steps.push("events")).pipe(
                  Effect.andThen(events.record(statements))
                ),
            }),
            Layer.succeed(SubscriberIntake, {
              agent: {
                enabled: scenario.enabled,
                submit: (input) =>
                  Effect.sync(() => {
                    forwarded.push(input);
                    steps.push("forward");

                    return { kind: "accepted" } as const;
                  }),
              },
              submit: () => Effect.succeed({ kind: "refused" } as const),
            })
          )
        )
      );

      const result = yield* joinInterest
        .handler({
          ...card,
          consent: { contact: true, share: scenario.share },
          ticket,
        })
        .pipe(
          Effect.provide(layer),
          Effect.provideService(JoinRequest, {
            allow: () =>
              Effect.sync(() => {
                steps.push("gate");

                return scenario.allowed;
              }),
            ip: scenario.validIp ? "203.0.113.17" : undefined,
            userAgent: "property-test",
          })
        );

      const eligible =
        scenario.enabled &&
        scenario.allowed &&
        scenario.validTicket &&
        scenario.validIp;

      expect(result.message).toBe(
        scenario.enabled ? JOIN_ANSWER : JOIN_NOT_OPEN
      );
      expect(result.statusRef).not.toContain(card.email);
      expect(forwarded.length).toBe(
        eligible && !scenario.hold && scenario.eventsUp ? 1 : 0
      );
      const contact = yield* contacts.read(result.statusRef);
      expect(contact !== undefined).toBe(eligible);

      if (eligible) {
        expect(steps.slice(0, 3)).toEqual(["gate", "ticket", "score"]);
        expect(contact?.state).toBe(
          scenario.hold || !scenario.eventsUp ? "held" : "accepted"
        );

        if (scenario.eventsUp) {
          const recorded = yield* IntakeEventsTest.use(
            (test) => test.statements
          );

          expect(JSON.stringify(recorded)).not.toContain(card.email);
          expect(
            recorded.find(
              (statement) => statement.object === "tokenmaxx/consents/share"
            )?.result
          ).toBe(scenario.share);
          expect(
            recorded.every(
              (statement) =>
                statement.actor === contact?.contactRef &&
                statement.context.submissionId === result.statusRef
            )
          ).toBe(true);
          expect(
            recorded
              .filter((statement) => statement.verb === "answered")
              .map((statement) => statement.object)
          ).toEqual([
            "tokenmaxx/questions/building",
            "tokenmaxx/questions/leaveWith",
          ]);
          expect(
            recorded.every((statement) =>
              Schema.is(Schema.String.check(Schema.isUUID(7)))(statement.id)
            )
          ).toBe(true);
        }
      }

      const [payload] = forwarded;

      if (payload !== undefined) {
        expect(payload).not.toHaveProperty("answers");
        expect(payload).not.toHaveProperty("consent");
        expect(payload).not.toHaveProperty("challenge");
        expect(payload.source).toBe("agent");
        expect(payload.hold).toBe(false);
        expect(payload.clientBucket.ipHash).toMatch(/^[a-f0-9]{64}$/u);
        expect(payload.clientBucket.uaHash).toMatch(/^[a-f0-9]{64}$/u);
      }
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
      const sent: AgentIntakeRequest[] = [];
      const tickets = yield* IntakeTicket;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);

      const layer = joinIntakeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            base,
            IntakeEvents.testLayer,
            Layer.succeed(IntakeTicket, tickets),
            AbuseScore.testLayer(),
            Layer.succeed(SubscriberIntake, {
              agent: {
                enabled: true,
                submit: (input) =>
                  Effect.sync((): IntakeResult => {
                    const kind = generated[sent.length] ?? "refused";
                    sent.push(input);

                    return kind === "retry"
                      ? { afterSeconds: 0, kind }
                      : { kind };
                  }),
              },
              submit: () => Effect.succeed({ kind: "refused" } as const),
            })
          )
        )
      );

      const submit = joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provide(layer),
        Effect.provideService(JoinRequest, {
          allow: () => Effect.succeed(true),
          ip: "203.0.113.17",
          userAgent: "property-test",
        })
      );

      const first = yield* submit;

      const firstSettled = generated.findIndex((kind) => kind !== "retry");

      const expectedAttempts = Math.min(
        3,
        firstSettled === -1 ? generated.length + 1 : firstSettled + 1
      );

      expect(sent.length).toBe(expectedAttempts);
      expect(
        sent.every((input) => input.submissionId === first.statusRef)
      ).toBe(true);
      expect(
        sent.every(
          (input) => input.clientBucket.ipHash === sent[0]?.clientBucket.ipHash
        )
      ).toBe(true);
      const second = yield* submit;
      expect(second.message).toBe(first.message);
      expect(second.statusRef).not.toBe(first.statusRef);
      expect(sent.length).toBe(expectedAttempts);
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
            Layer.succeed(SubscriberIntake, {
              agent: {
                enabled: true,
                submit: () => Effect.succeed({ kind: "accepted" } as const),
              },
              submit: () => Effect.succeed({ kind: "refused" } as const),
            })
          )
        )
      );

      const services = yield* Layer.build(layer);
      yield* joinInterest.handler({ ...card, ticket }).pipe(
        Effect.provideContext(services),
        Effect.provideService(JoinRequest, {
          allow: () => Effect.succeed(true),
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
