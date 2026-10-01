import { IntakeTicket } from "@rat-stack/core/intake";
import {
  PAGE_TICKET_PLACEHOLDER,
  withPageTicket,
} from "@rat-stack/intake-live";
import { Effect, Option } from "effect";

export const withAvailablePageTicket = Effect.fn("withAvailablePageTicket")(
  function* withAvailablePageTicket(body: string) {
    const tickets = yield* Effect.serviceOption(IntakeTicket);

    return Option.isSome(tickets)
      ? yield* withPageTicket(body).pipe(
          Effect.provideService(IntakeTicket, tickets.value)
        )
      : body.replaceAll(PAGE_TICKET_PLACEHOLDER, "");
  }
);
