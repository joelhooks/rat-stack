import { describe, expect, it } from "@effect/vitest";
import {
  IntakeTicket,
  PAGE_TICKET_SOURCE,
  TICKET_TTL_MILLIS,
  TicketSourceSchema,
} from "@rat-stack/core/intake";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import {
  hmacIntakeTicketLayer,
  PAGE_TICKET_PLACEHOLDER,
  TicketBindings,
  withPageTicket,
} from "../src/index.js";

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
    at: Schema.Literals([0, 7, 30, 1000]),
    kind: Schema.Literal("tamper"),
    ticket: Schema.Literals([0, 1, 2]),
  }),
  Schema.Struct({
    hours: Schema.Literals([1, 24, 71, 72]),
    kind: Schema.Literal("wait"),
  }),
]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 40 });

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

      if (step.kind === "tamper") {
        const position = step.at % ticket.value.length;
        const original = ticket.value.charAt(position);
        const replacement = original === "A" ? "B" : "A";

        const tampered = `${ticket.value.slice(0, position)}${replacement}${ticket.value.slice(position + 1)}`;

        const refused = yield* Effect.flip(
          tickets.verify(tampered, `submission-${step.at}`)
        );

        expect(refused.reason).toBe("unknown");
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

const secret = Redacted.make("interest-token-secret-for-tests");

const hmacTickets = (key: Redacted.Redacted) =>
  hmacIntakeTicketLayer(key).pipe(Layer.provide(TicketBindings.memoryLayer));

describe("hmac intake tickets", () => {
  it.effect.prop(
    "agree with the ticket model, and refuse forged and tampered tickets",
    { generated: steps },
    ({ generated }) =>
      runAgainstModel(generated).pipe(Effect.provide(hmacTickets(secret))),
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
    }).pipe(Effect.provide(hmacTickets(secret)))
  );

  it.effect("refuse a ticket signed under another secret", () =>
    Effect.gen(function* otherSecret() {
      const minted = yield* Effect.gen(function* mintElsewhere() {
        const elsewhere = yield* IntakeTicket;

        return yield* elsewhere.mint(PAGE_TICKET_SOURCE);
      }).pipe(Effect.provide(hmacTickets(Redacted.make("another-secret"))));

      const tickets = yield* IntakeTicket;

      const refused = yield* Effect.flip(
        tickets.verify(minted, "submission-0")
      );

      expect(refused.reason).toBe("unknown");
    }).pipe(Effect.provide(hmacTickets(secret)))
  );

  it.effect("fill every page placeholder with one fresh page ticket", () =>
    Effect.gen(function* pageTicket() {
      const tickets = yield* IntakeTicket;

      const page = yield* withPageTicket(
        `ticket ${PAGE_TICKET_PLACEHOLDER} again ${PAGE_TICKET_PLACEHOLDER}`
      );

      const [, first, , second] = page.split(" ");

      expect(first).toBe(second);
      expect(page).not.toContain(PAGE_TICKET_PLACEHOLDER);
      expect(yield* tickets.verify(first ?? "", "submission-0")).toStrictEqual({
        mintedAt: 0,
        source: PAGE_TICKET_SOURCE,
      });
      expect(yield* withPageTicket("no placeholder")).toBe("no placeholder");
    }).pipe(Effect.provide(hmacTickets(secret)))
  );
});
