import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import {
  IntakeTicket,
  PAGE_TICKET_SOURCE,
  TICKET_TTL_MILLIS,
  TicketSourceSchema,
} from "../src/intake.js";

const sources = [
  PAGE_TICKET_SOURCE,
  Schema.decodeSync(TicketSourceSchema)("x"),
  Schema.decodeSync(TicketSourceSchema)("newsletter"),
] as const;

const Step = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("mint"),
    source: Schema.Literals([0, 1, 2]),
  }),
  Schema.Struct({
    kind: Schema.Literal("verify"),
    submission: Schema.Literals([0, 1]),
    ticket: Schema.Literals([0, 1, 2]),
  }),
  Schema.Struct({ kind: Schema.Literal("forge") }),
  Schema.Struct({
    hours: Schema.Literals([1, 24, 71, 72]),
    kind: Schema.Literal("wait"),
  }),
]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 40 });

const channelCharacter = Schema.Literals([
  "a",
  "z",
  "0",
  "9",
  "-",
  "A",
  "_",
  " ",
  "/",
  "é",
]);

const candidateChannel = Arbitrary.array(Arbitrary.schema(channelCharacter), {
  maxLength: 40,
}).pipe(Arbitrary.map((characters) => characters.join("")));

interface ModelTicket {
  boundTo: number | undefined;
  readonly mintedAt: number;
  readonly source: 0 | 1 | 2;
  readonly value: string;
}

const expectedReason = (
  ticket: ModelTicket,
  submission: number,
  now: number
) => {
  if (now >= ticket.mintedAt + TICKET_TTL_MILLIS) {
    return "expired";
  }

  return ticket.boundTo !== undefined && ticket.boundTo !== submission
    ? "reused"
    : undefined;
};

const runAgainstModel = (generated: readonly (typeof Step.Type)[]) =>
  Effect.gen(function* replay() {
    const tickets = yield* IntakeTicket;
    const model: ModelTicket[] = [];
    let now = 0;

    for (const step of generated) {
      if (step.kind === "wait") {
        now += step.hours * 60 * 60 * 1000;
        yield* TestClock.adjust(`${step.hours} hours`);
        continue;
      }

      if (step.kind === "mint") {
        const value = yield* tickets.mint(sources[step.source]);
        expect(model.some((ticket) => ticket.value === value)).toBe(false);
        model.push({
          boundTo: undefined,
          mintedAt: now,
          source: step.source,
          value,
        });
        continue;
      }

      if (step.kind === "forge") {
        const forged = yield* Effect.flip(
          tickets.verify("forged-ticket", "submission-0")
        );

        expect(forged.reason).toBe("unknown");
        continue;
      }

      const ticket = model[step.ticket];

      if (ticket === undefined) {
        continue;
      }

      const reason = expectedReason(ticket, step.submission, now);

      const verifying = tickets.verify(
        ticket.value,
        `submission-${step.submission}`
      );

      if (reason === undefined) {
        expect(yield* verifying).toStrictEqual({
          mintedAt: ticket.mintedAt,
          source: sources[ticket.source],
        });
        ticket.boundTo = step.submission;
      } else {
        expect((yield* Effect.flip(verifying)).reason).toBe(reason);
      }
    }
  });

describe("intake tickets", () => {
  it.effect.prop(
    "agree with the model: one submission per ticket, retries pass, expiry after 72 hours",
    { generated: steps },
    ({ generated }) =>
      runAgainstModel(generated).pipe(Effect.provide(IntakeTicket.testLayer)),
    { arbitrary: { runs: 300 } }
  );

  it.effect("pass a retry of the same submission and refuse a second one", () =>
    Effect.gen(function* retryThenReuse() {
      const tickets = yield* IntakeTicket;
      const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);
      const claims = { mintedAt: 0, source: PAGE_TICKET_SOURCE };

      expect(yield* tickets.verify(ticket, "submission-a")).toStrictEqual(
        claims
      );
      expect(yield* tickets.verify(ticket, "submission-a")).toStrictEqual(
        claims
      );
      expect(
        (yield* Effect.flip(tickets.verify(ticket, "submission-b"))).reason
      ).toBe("reused");
    }).pipe(Effect.provide(IntakeTicket.testLayer))
  );

  it.effect.prop(
    "accept only short lowercase channel names as a source",
    { candidate: candidateChannel },
    ({ candidate }) =>
      Effect.sync(() => {
        const accepted = Schema.is(TicketSourceSchema)(candidate);

        const isChannelName =
          candidate.length >= 1 &&
          candidate.length <= 32 &&
          candidate.replaceAll(/[a-z0-9-]/gu, "") === "";

        expect(accepted).toBe(isChannelName);
      })
  );
});
