import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";

import { InvalidTicket } from "./invalid-ticket.js";

export const TICKET_TTL_MILLIS = 72 * 60 * 60 * 1000;

export const TicketSourceSchema = Schema.String.check(
  Schema.isLengthBetween(1, 32),
  Schema.isPattern(/^[a-z0-9-]+$/u)
).pipe(Schema.brand("TicketSource"));

export type TicketSource = typeof TicketSourceSchema.Type;

export const PAGE_TICKET_SOURCE = Schema.decodeSync(TicketSourceSchema)("page");

export const TicketClaimsSchema = Schema.Struct({
  mintedAt: Schema.Finite,
  source: TicketSourceSchema,
});

export type TicketClaims = typeof TicketClaimsSchema.Type;

export const isExpired = (claims: TicketClaims, now: number) =>
  now >= claims.mintedAt + TICKET_TTL_MILLIS;

interface HeldTicket {
  readonly boundTo: string | undefined;
  readonly claims: TicketClaims;
}

export class IntakeTicket extends Context.Service<
  IntakeTicket,
  {
    readonly mint: (source: TicketSource) => Effect.Effect<string>;
    readonly verify: (
      ticket: string,
      submissionId: string
    ) => Effect.Effect<TicketClaims, InvalidTicket>;
  }
>()("@rat-stack/core/IntakeTicket") {
  static readonly testLayer = Layer.effect(
    this,
    Effect.gen(function* makeTestTickets() {
      const held = yield* Ref.make(new Map<string, HeldTicket>());
      const minted = yield* Ref.make(0);

      const mint = Effect.fn("IntakeTicket.test.mint")(function* mint(
        source: TicketSource
      ) {
        const mintedAt = yield* Clock.currentTimeMillis;
        const count = yield* Ref.updateAndGet(minted, (value) => value + 1);
        const ticket = `test-ticket-${count}`;

        yield* Ref.update(held, (tickets) =>
          new Map(tickets).set(ticket, {
            boundTo: undefined,
            claims: { mintedAt, source },
          })
        );

        return ticket;
      });

      const verify = Effect.fn("IntakeTicket.test.verify")(function* verify(
        ticket: string,
        submissionId: string
      ) {
        const now = yield* Clock.currentTimeMillis;
        const entry = (yield* Ref.get(held)).get(ticket);

        if (entry === undefined) {
          return yield* new InvalidTicket({ reason: "unknown" });
        }

        if (isExpired(entry.claims, now)) {
          return yield* new InvalidTicket({ reason: "expired" });
        }

        if (entry.boundTo !== undefined && entry.boundTo !== submissionId) {
          return yield* new InvalidTicket({ reason: "reused" });
        }

        yield* Ref.update(held, (tickets) =>
          new Map(tickets).set(ticket, { ...entry, boundTo: submissionId })
        );

        return entry.claims;
      });

      return { mint, verify };
    })
  );
}
