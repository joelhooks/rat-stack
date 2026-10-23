import {
  Context,
  Crypto,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";

import { AbuseScore, SCORER_UNAVAILABLE } from "./abuse-score.js";
import { ContactRefSchema, IntakeEvents } from "./intake-events.js";
import type {
  IntakeObject,
  IntakeStatement,
  IntakeVerb,
} from "./intake-events.js";
import { QuestionIdSchema } from "./intake-questions.js";
import { IntakeTicket } from "./intake-ticket.js";
import { normalizeAddress } from "./interest-address.js";
import { SubscriberIntake } from "./interest-intake.js";
import { normalizeClientIp } from "./interest-ip.js";
import { InterestTokens } from "./interest-token.js";
import { JoinContactStore } from "./join-contact-store.js";
import { runJoinDelivery } from "./join-delivery-machine.js";
import {
  JOIN_ANSWER,
  JOIN_BUSY,
  JOIN_DELAYED,
  JOIN_NOT_OPEN,
} from "./join-interest-contract.js";
import type { JoinInput, JoinOutput } from "./join-interest-contract.js";
import { JoinInterest, newStatusRef } from "./join-interest-port.js";

type IdentityStatement = {
  -readonly [Key in "name" | "x"]?: Exclude<JoinInput[Key], undefined>;
};

export const JoinRequest = Context.Reference<{
  readonly ip: string | undefined;
  readonly userAgent: string;
  readonly allow: (
    agentRef: string
  ) => Effect.Effect<
    "allowed" | "ip_limited" | "agent_limited" | "unavailable"
  >;
  readonly afterResponse: (work: Effect.Effect<void>) => Effect.Effect<void>;
}>("@rat-stack/core/JoinRequest", {
  defaultValue: () => ({
    afterResponse: (work) => work,
    allow: () => Effect.succeed("unavailable"),
    ip: undefined,
    userAgent: "",
  }),
});

const deliveryStateFor = {
  accepted: "accepted",
  refused: "refused",
  retry: "ready",
} as const;

export const joinIntakeLayer = Layer.effect(
  JoinInterest,
  Effect.gen(function* makeJoinIntake() {
    const tickets = yield* IntakeTicket;
    const scorer = yield* AbuseScore;
    const events = yield* IntakeEvents;
    const contacts = yield* JoinContactStore;
    const intake = yield* SubscriberIntake;
    const tokens = yield* InterestTokens;
    const crypto = yield* Crypto.Crypto;

    const submit = Effect.fn("JoinInterest.submit")(function* submit(
      input: JoinInput
    ): Effect.fn.Return<JoinOutput> {
      const statusRef = yield* newStatusRef;
      const answer = { message: JOIN_ANSWER, statusRef } as const;

      if (intake.agent?.enabled !== true) {
        return { message: JOIN_NOT_OPEN, statusRef };
      }

      return yield* Effect.gen(function* processSubmission() {
        const request = yield* JoinRequest;

        const gate = yield* request.allow(input.agentRef);

        if (gate === "ip_limited" || gate === "agent_limited") {
          return { message: JOIN_BUSY, statusRef: "unavailable" } as const;
        }

        if (gate !== "allowed") {
          return answer;
        }

        const ip = normalizeClientIp(request.ip);
        const address = normalizeAddress(input.email);

        if (Option.isNone(ip) || Option.isNone(address)) {
          return answer;
        }

        const ticket = yield* tickets.verify(input.ticket, statusRef);

        const clientBucket = {
          ipHash: yield* tokens.digest("ip", ip.value),
          uaHash: yield* tokens.digest("ua", request.userAgent),
        };

        const verdict = yield* scorer.score({
          agentRef: input.agentRef,
          answers: input.answers ?? {},
          clientBucket,
          ticket,
        });

        const scorerDelayed =
          verdict.hold &&
          verdict.signals.includes(SCORER_UNAVAILABLE) &&
          verdict.signals.every((signal) =>
            [
              SCORER_UNAVAILABLE,
              "ticket_instant",
              "no_answers",
              "jev_off",
              "jev_clear",
            ].includes(signal)
          );

        const held = verdict.hold && !scorerDelayed;

        const contactRef = yield* crypto.randomUUIDv4.pipe(
          Effect.flatMap(Schema.decodeEffect(ContactRefSchema)),
          Effect.orDie
        );

        yield* contacts.save({
          agentRef: input.agentRef,
          clientBucket,
          contactRef,
          email: address.value,
          hold: held,
          score: verdict.score,
          signals: verdict.signals,
          state: "held",
          submissionId: statusRef,
          ticket: input.ticket,
        });
        const timestamp = DateTime.formatIso(yield* DateTime.now);

        const statement = Effect.fn("JoinInterest.statement")(
          function* statement(
            verb: IntakeVerb,
            object: IntakeObject,
            result?: Schema.Json
          ): Effect.fn.Return<IntakeStatement> {
            const recorded: IntakeStatement = {
              actor: contactRef,
              context: { intake: "tokenmaxx", submissionId: statusRef },
              id: yield* crypto.randomUUIDv7.pipe(Effect.orDie),
              object,
              timestamp,
              verb,
            };

            return result === undefined ? recorded : { ...recorded, result };
          }
        );

        const identity: IdentityStatement = {};

        if (input.name !== undefined) {
          identity.name = input.name;
        }

        if (input.x !== undefined) {
          identity.x = input.x;
        }

        const statements: IntakeStatement[] = [
          yield* statement("started", "tokenmaxx/intake", identity),
        ];

        for (const question of QuestionIdSchema.literals) {
          const value = input.answers?.[question];

          if (value !== undefined) {
            statements.push(
              yield* statement(
                "answered",
                `tokenmaxx/questions/${question}`,
                value
              )
            );
          }
        }

        statements.push(
          yield* statement("consented", "tokenmaxx/consents/contact", true),
          yield* statement(
            "consented",
            "tokenmaxx/consents/share",
            input.consent.share ?? false
          ),
          yield* statement("submitted", "tokenmaxx/intake", {
            held,
            score: verdict.score,
            signals: [...verdict.signals],
          })
        );
        yield* events.record(statements);

        if (scorerDelayed) {
          yield* contacts.setState(statusRef, "ready");

          return { message: JOIN_DELAYED, statusRef: "unavailable" } as const;
        }

        if (held) {
          return answer;
        }

        yield* contacts.setState(statusRef, "ready");

        yield* request.afterResponse(
          runJoinDelivery({ submissionId: statusRef }).pipe(
            Effect.flatMap((result) =>
              contacts.setState(statusRef, deliveryStateFor[result.kind])
            ),
            Effect.provideService(SubscriberIntake, intake),
            Effect.provideService(JoinContactStore, contacts),
            Effect.catchCause(() =>
              Effect.logWarning(
                "joinInterest delivery stopped; the contact stays ready for intakeRedeliver"
              )
            )
          )
        );

        return answer;
      }).pipe(Effect.catchCause(() => Effect.succeed(answer)));
    });

    return { submit };
  })
);
