import { IntakeTicket, PAGE_TICKET_SOURCE } from "@rat-stack/core/intake";
import { PAGE_TICKET_PLACEHOLDER } from "@rat-stack/intake-live";
import { Effect, Option } from "effect";

export const SIGNUP_UNAVAILABLE =
  "Signup is temporarily unavailable; try again shortly.";

const unavailableSignup = (body: string) =>
  body
    .replace(
      /The page ticket is:[\s\S]*?Do not claim they joined or received a seat from the submission response\./u,
      SIGNUP_UNAVAILABLE
    )
    .replaceAll(PAGE_TICKET_PLACEHOLDER, SIGNUP_UNAVAILABLE);

export const withAvailablePageTicket = Effect.fn("withAvailablePageTicket")(
  function* withAvailablePageTicket(body: string) {
    if (!body.includes(PAGE_TICKET_PLACEHOLDER)) {
      return body;
    }

    const tickets = yield* Effect.serviceOption(IntakeTicket);

    if (Option.isNone(tickets)) {
      return unavailableSignup(body);
    }

    return yield* tickets.value.mint(PAGE_TICKET_SOURCE).pipe(
      Effect.map((ticket) =>
        ticket.length === 0
          ? unavailableSignup(body)
          : body.replaceAll(PAGE_TICKET_PLACEHOLDER, ticket)
      ),
      Effect.catchCause(() => Effect.succeed(unavailableSignup(body)))
    );
  }
);
