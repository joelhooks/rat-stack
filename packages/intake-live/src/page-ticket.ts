import { IntakeTicket, PAGE_TICKET_SOURCE } from "@rat-stack/core/intake";
import { Effect } from "effect";

export const PAGE_TICKET_PLACEHOLDER = "__INTAKE_PAGE_TICKET__";

export const withPageTicket = (body: string) =>
  body.includes(PAGE_TICKET_PLACEHOLDER)
    ? Effect.gen(function* mintPageTicket() {
        const tickets = yield* IntakeTicket;
        const ticket = yield* tickets.mint(PAGE_TICKET_SOURCE);

        return body.replaceAll(PAGE_TICKET_PLACEHOLDER, ticket);
      })
    : Effect.succeed(body);
